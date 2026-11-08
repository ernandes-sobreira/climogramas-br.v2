import calendar, datetime as dt, gzip, json, math, pathlib, sys, tempfile, unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'tools'))
from ana_summary_codec import compact, expand, encode, decode
import sync_ana_monthly as pipeline
from types import SimpleNamespace

def summary(kind='chuva'):
    rows=[]
    for month,n,total in [(1,31,31.12345678912345),(2,28,14.3333333333333),(3,0,0)]:
        expected=calendar.monthrange(2024,month)[1];value=total if kind=='chuva' else total/n if n else None
        rows.append(dict(ano=2024,mes=month,sum=total,dias=n,esperados=expected,cobertura=n/expected,completo=n==expected,observado=value if n else None,valor=value if n==expected else None,last_date=f'2024-{month:02d}-{n:02d}' if n else None))
    return dict(schema_version=1,variable=kind,station='1657000',consistency='1',unit='mm',checked_ranges=[dict(start='2024-01-01',end='2024-12-31')],months=rows,years=pipeline.annual(rows,kind,dt.date(2026,1,1)),stale=True)
class CodecTests(unittest.TestCase):
    def test_lossless_roundtrip(self):
        source=summary();result=decode(encode(source),dt.date(2026,1,1))
        self.assertEqual(result['months'],source['months'][:2]);self.assertEqual(result['years'],source['years']);self.assertEqual(result['checked_ranges'],source['checked_ranges']);self.assertTrue(result['stale'])
    def test_weighted_mean(self):
        s=summary('cotas');r=decode(encode(s));self.assertEqual(r['years'][0]['valor'],(31.12345678912345+14.3333333333333)/59)
        self.assertNotEqual(r['years'][0]['valor'],sum(m['observado'] for m in r['months'])/2)
    def test_partial_null_leap(self):
        r=decode(encode(summary()));self.assertIsNone(r['months'][1]['valor']);self.assertEqual(r['months'][1]['esperados'],29)
    def test_deterministic(self):self.assertEqual(encode(summary()),encode(summary()))
    def test_empty(self):
        s=summary();s['months']=[];r=decode(encode(s));self.assertEqual(r['months'],[]);self.assertEqual(r['years'],[]);self.assertTrue(r['empty'])
    def test_bad_duplicate_rejected(self):
        s=summary();s['months'].append(s['months'][0]);self.assertRaises(ValueError,encode,s)
    def test_bad_nonfinite_rejected(self):
        s=summary();s['months'][0]['sum']=float('nan');self.assertRaises(ValueError,encode,s)
    def test_pipeline_writes_compact_without_deleting_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);old=root/'summaries/chuva/1657000/nivel1.json';pipeline.write(old,summary())
            pipeline.write(root/'catalog/MT.json',{'stations':[dict(code='1657000',candidate_variables=['chuva'],periods={'PeriodoPluviometroInicio':'2024','PeriodoPluviometroFim':'2024'})]})
            args=SimpleNamespace(root=tmp,budget=1,max_seconds=20,max_mib=10,delay=0,compressed=True)
            result=pipeline.run(args,request=lambda *a,**k:b'<DataSet/>')
            self.assertEqual(result['success_this_run'],1);self.assertTrue(old.exists())
            compressed=root/'compact/chuva/1657000/nivel1.json.gz';self.assertTrue(compressed.exists());self.assertTrue(decode(compressed.read_bytes())['stale'])
    def test_annual_preserves_float_order(self):
        source=summary();source['years'][0]['valor']+=1e-13
        self.assertEqual(decode(encode(source))['years'][0]['valor'],source['years'][0]['valor'])
    def test_annual_inconsistent_rejected(self):
        packed=compact(summary());packed['annual_values'][0][1]+=100
        self.assertRaises(ValueError,expand,packed)
    def test_gzip_unchanged_on_next_month(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);pipeline.write(root/'catalog/MT.json',{'stations':[dict(code='1657000',candidate_variables=['chuva'],periods={'PeriodoPluviometroInicio':'2026','PeriodoPluviometroFim':'2026'})]})
            args=SimpleNamespace(root=tmp,budget=1,max_seconds=20,max_mib=350,delay=0,compressed=True)
            xml=b'<DataSet><SerieHistorica><EstacaoCodigo>1657000</EstacaoCodigo><NivelConsistencia>1</NivelConsistencia><DataHora>2026-01-01</DataHora><Chuva01>1</Chuva01><Chuva01Status>1</Chuva01Status></SerieHistorica></DataSet>'
            original=pipeline.utcnow
            try:
                pipeline.utcnow=lambda:'2026-11-08T12:00:00+00:00'
                pipeline.run(args,request=lambda *a,**k:xml,today=dt.date(2026,11,8))
                path=root/'compact/chuva/1657000/nivel1.json.gz';before=path.read_bytes()
                pipeline.utcnow=lambda:'2026-12-08T12:00:00+00:00'
                result=pipeline.run(args,request=lambda *a,**k:xml,today=dt.date(2026,12,8))
                self.assertEqual(result['requests_this_run'],1);self.assertEqual(before,path.read_bytes())
                state=pipeline.read(root/'monthly-state.json',{})
                self.assertTrue(any(r.get('last_success_utc','').startswith('2026-12') for r in state['tasks'].values()))
            finally:pipeline.utcnow=original
if __name__=='__main__':unittest.main()
