import datetime as dt
import hashlib
import importlib.util
import io
import json
import pathlib
import tempfile
import unittest
import zipfile
from unittest import mock
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('sync_inmet_test',ROOT/'tools/sync_inmet.py')
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)

def zip_fixture(year,valid=True):
    data='UF:;MT\nESTACAO:;TESTE\nCODIGO (WMO):;A001\nLATITUDE:-16\nLONGITUDE:-57\nDATA (YYYY-MM-DD);HORA (UTC);PRECIPITACAO TOTAL, HORARIO (mm);TEMPERATURA DO AR - BULBO SECO, HORARIA (C)\n'
    if valid:
        for d in range(1,32):
            for h in range(24):data+=f'{year}/01/{d:02d};{h:02d}00 UTC;1;26\n'
    else:data='invalid csv'
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w') as z:z.writestr('INMET_MT_A001_TESTE.csv',data)
    return out.getvalue()

class SyncTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.assets=pathlib.Path(self.tmp.name)/'assets';self.assets.mkdir()
        self.year=dt.datetime.now(dt.timezone.utc).year-1
        (self.assets/'stations.json').write_text(json.dumps([{'id':'A001','name':'TESTE','uf':'MT','years':[self.year-1]}]))
        (self.assets/'years.json').write_text(json.dumps({'years':[self.year-1]}))
        historic=self.assets/'data/A001'/f'{self.year-1}.json';historic.parent.mkdir(parents=True);historic.write_text('{"historic":true}')
        self.patch=mock.patch.object(mod,'ASSETS',self.assets);self.patch.start();self.addCleanup(self.patch.stop)
        self.raw=zip_fixture(self.year)
    def state(self):return json.loads((self.assets/'inmet-update-status.json').read_text())
    def sync(self,raw=None,force=False):
        with mock.patch.object(mod,'download',return_value=raw if raw is not None else self.raw):return mod.sync_years([self.year],force)
    def test_real_small_zip_and_no_historical_deletion(self):
        self.assertEqual(self.sync(),[])
        data=json.loads((self.assets/f'data/A001/{self.year}.json').read_text())
        self.assertEqual(data['months'][0]['p'],744)
        self.assertEqual(data['months'][0]['tmean'],26)
        self.assertIsNone(data['annual']['p_total'])
        self.assertEqual((self.assets/f'data/A001/{self.year-1}.json').read_text(),'{"historic":true}')
        self.assertEqual(self.state()['years'][0]['status'],'updated')
    def test_identical_hash_never_parses_or_rewrites_station_or_catalog(self):
        self.sync();paths=[self.assets/f'data/A001/{self.year}.json',self.assets/'stations.json',self.assets/'years.json'];before=[(p.read_bytes(),p.stat().st_mtime_ns)for p in paths];processed=self.state()['years'][0]['processed_utc']
        with mock.patch.object(mod,'process_year',side_effect=AssertionError('must not parse')):self.sync()
        self.assertEqual(before,[(p.read_bytes(),p.stat().st_mtime_ns)for p in paths]);self.assertEqual(self.state()['years'][0]['status'],'unchanged');self.assertEqual(self.state()['years'][0]['processed_utc'],processed)
    def test_download_failure_preserves_data_sha_and_success(self):
        self.sync();before=self.state()['years'][0].copy();data=(self.assets/f'data/A001/{self.year}.json').read_bytes()
        with mock.patch.object(mod,'download',side_effect=TimeoutError):self.assertEqual(mod.sync_years([self.year]),[self.year])
        after=self.state()['years'][0];self.assertEqual(after['status'],'error');self.assertEqual(after['source_sha256'],before['source_sha256']);self.assertEqual(after['last_success_utc'],before['last_success_utc']);self.assertEqual((self.assets/f'data/A001/{self.year}.json').read_bytes(),data)
    def test_bad_csv_does_not_publish_or_accept_new_hash(self):
        self.sync();before=(self.assets/f'data/A001/{self.year}.json').read_bytes();sha=self.state()['years'][0]['source_sha256']
        self.assertEqual(self.sync(zip_fixture(self.year,False)),[self.year]);self.assertEqual((self.assets/f'data/A001/{self.year}.json').read_bytes(),before);self.assertEqual(self.state()['years'][0]['source_sha256'],sha)
    def test_force_reprocesses_same_hash(self):
        self.sync();original=mod.process_year
        with mock.patch.object(mod,'process_year',wraps=original)as call:self.sync(force=True);self.assertEqual(call.call_count,1)
    def test_truncated_valid_zip_is_quarantined_and_never_replaces_744mm(self):
        self.sync();target=self.assets/f'data/A001/{self.year}.json';before=target.read_bytes();oldsha=self.state()['years'][0]['source_sha256']
        with zipfile.ZipFile(io.BytesIO(self.raw))as z:csv=z.read(z.namelist()[0]).decode()
        out=io.BytesIO()
        with zipfile.ZipFile(out,'w')as z:z.writestr('INMET_MT_A001_TESTE.csv','\n'.join(csv.splitlines()[:7])+'\n')
        truncated=out.getvalue();self.assertEqual(self.sync(truncated),[self.year]);self.assertEqual(target.read_bytes(),before)
        state=self.state()['years'][0];self.assertEqual(state['status'],'regression_preserved');self.assertEqual(state['source_sha256'],oldsha);self.assertEqual(json.loads(target.read_text())['months'][0]['p'],744)
        with mock.patch.object(mod,'process_year')as processing:self.sync(truncated);processing.assert_not_called()
    def test_station_missing_from_valid_zip_quarantines_year(self):
        self.sync();target=self.assets/f'data/A001/{self.year}.json';other=self.assets/f'data/A002/{self.year}.json';other.parent.mkdir();other.write_bytes(target.read_bytes())
        before=target.read_bytes();self.assertEqual(self.sync(force=True),[self.year]);self.assertEqual(target.read_bytes(),before);self.assertTrue(any(x.get('station')=='A002' and x.get('missing_from_candidate') for x in self.state()['years'][0]['regressions']))
    def test_legacy_state_sha_migrates_without_reprocessing(self):
        status={'updated_utc':'2026-01-01T00:00:00+00:00','years':[{'year':self.year,'stations':1,'source_sha256':hashlib.sha256(self.raw).hexdigest()},{'year':self.year-1,'stations':1,'source_sha256':'older'}]}
        (self.assets/'inmet-update-status.json').write_text(json.dumps(status))
        with mock.patch.object(mod,'process_year',side_effect=AssertionError):self.sync()
        self.assertEqual(len(self.state()['years']),2);self.assertEqual(self.state()['years'][1]['processed_utc'],status['updated_utc'])

if __name__=='__main__':unittest.main()
