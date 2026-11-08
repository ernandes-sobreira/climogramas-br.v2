import importlib.util, pathlib, sys, unittest, tempfile, datetime as dt
from types import SimpleNamespace
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'tools'))
import sync_ana as new
spec=importlib.util.spec_from_file_location('old',pathlib.Path(__file__).with_name('sync_ana_reference.py'));old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old)
FIX=ROOT/'tests/ana/fixtures'

def xml_rows(rows):
    return ('<DataSet>'+''.join('<SerieHistorica>'+''.join(f'<{k}>{v}</{k}>' for k,v in row.items())+'</SerieHistorica>' for row in rows)+'</DataSet>').encode()

class ParseOnceTests(unittest.TestCase):
    def test_repo_fixtures_exact(self):
        for kind,code in [('chuva','1657003'),('cotas','66070004'),('vazao','66070004')]:
            xml=(FIX/f'{kind}-{code}-2000-01.xml').read_bytes();records=new.rows(xml,'SerieHistorica')
            for year in (1999,2000,2001):
                self.assertEqual(old.parse_series(xml,code,kind,year),new.parse_series_rows(records,code,kind,year))
                self.assertEqual(old.parse_series(xml,code,kind,year),new.parse_series(xml,code,kind,year))
    def test_conflict_missing_levels_status_leap(self):
        for kind,field in [('chuva','Chuva'),('cotas','Cota'),('vazao','Vazao')]:
            a={'EstacaoCodigo':'123456','DataHora':'2000-02-01','NivelConsistencia':'1',field+'01':'0',field+'01Status':'1',field+'02':'-999',field+'02Status':'1',field+'03':'1,25',field+'03Status':'2',field+'04':'NaN',field+'04Status':'1',field+'29':'-5',field+'29Status':'1'}
            rows=[a,a,{**a,field+'01':'3'},{**a,'NivelConsistencia':'2'},{**a,'NivelConsistencia':'3'},{**a,'EstacaoCodigo':'654321'},{**a,'DataHora':'invalid'},{**a,'DataHora':'2001-02-01'}]
            xml=xml_rows(rows);parsed=new.parse_series_rows(new.rows(xml,'SerieHistorica'),'123456',kind,2000)
            self.assertEqual(parsed,old.parse_series(xml,'123456',kind,2000));self.assertTrue(any(r['status']=='conflict' for r in parsed['observations']))
            zero=new.parse_series(xml_rows([a]),'123456',kind,2000)['observations'][0]
            self.assertEqual(zero['value'],0);self.assertTrue(zero['usable'])
    def test_security_wrapper_still_rejects(self):
        for xml in (b'<!DOCTYPE x><DataSet/>',b'<html/>',b'<DataSet>'):
            with self.assertRaises(Exception):new.parse_series(xml,'123456','chuva',2000)
    def test_wrapper_calls_rows_once(self):
        with patch.object(new,'rows',wraps=new.rows) as counter:
            new.parse_series(b'<DataSet/>','123456','chuva',2000)
            self.assertEqual(counter.call_count,1)
    def test_sixty_year_single_xml_parse(self):
        xml=xml_rows([{'EstacaoCodigo':'123456','DataHora':f'{year}-01-01','NivelConsistencia':'1','Chuva01':'1','Chuva01Status':'1'} for year in range(1960,2020)])
        with patch.object(new,'rows',wraps=new.rows) as counter:
            records=new.rows(xml,'SerieHistorica');result={year:new.parse_series_rows(records,'123456','chuva',year) for year in range(1960,2020)}
            self.assertEqual(counter.call_count,1)
        self.assertEqual(sum(len(p['observations']) for p in result.values()),60)
    def test_monthly_pipeline_parses_response_once(self):
        import sync_ana_monthly as monthly
        xml=xml_rows([{'EstacaoCodigo':'123456','DataHora':f'{year}-01-01','NivelConsistencia':'1','Chuva01':'1','Chuva01Status':'1'} for year in range(1960,2020)])
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);new.write(root/'catalog/MT.json',{'stations':[dict(code='123456',candidate_variables=['chuva'],periods={'PeriodoPluviometroInicio':'1960','PeriodoPluviometroFim':'2019'})]})
            args=SimpleNamespace(root=tmp,budget=1,max_seconds=20,max_mib=350,delay=0,compressed=True)
            with patch.object(monthly,'rows',wraps=new.rows) as counter:
                status=monthly.run(args,request=lambda *a,**k:xml,today=dt.date(2026,11,8))
                self.assertEqual(status['success_this_run'],1);self.assertEqual(counter.call_count,1)
if __name__=='__main__':unittest.main()
