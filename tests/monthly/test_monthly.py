import datetime as dt, pathlib, sys, tempfile, unittest
from types import SimpleNamespace
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'tools'))
import sync_ana_monthly as m

def parsed(days, value=1):
    return {'observations':[{'date':f'2024-02-{d:02d}','consistency':'1','value':value,'usable':True} for d in range(1,days+1)]}
class MonthlyTests(unittest.TestCase):
    def test_complete_and_partial(self):
        rows=m.summarize(parsed(29),2024,'1','chuva');r=rows[1]
        self.assertEqual(r['valor'],29);self.assertTrue(r['completo'])
        rows=m.summarize(parsed(28),2024,'1','chuva');self.assertIsNone(rows[1]['valor']);self.assertEqual(rows[1]['observado'],28)
    def test_level_isolation(self):
        self.assertEqual(m.summarize(parsed(29),2024,'2','chuva')[1]['dias'],0)
    def test_preserve_regression(self):
        task=dict(code='1657000',uf='MT',kind='chuva',level='1',start=2024,end=2024)
        a=m.merge({},m.summarize(parsed(29),2024,'1','chuva'),task,'2026-01-01',dt.date(2026,1,1))
        b=m.merge(a,m.summarize(parsed(1),2024,'1','chuva'),task,'2026-02-01',dt.date(2026,2,1))
        self.assertEqual(b['months'][0]['dias'],29);self.assertTrue(b['retained_after_regression'])
    def test_inactive_included(self):
        station=dict(code='1657000',candidate_variables=['chuva'],operating='0',periods={'PeriodoPluviometroInicio':'1912-01-01','PeriodoPluviometroFim':'1999-12-31'})
        tasks=list(m.tasks({'MT':[station]},dt.date(2026,1,1)))
        self.assertEqual(min(t['start'] for t in tasks),1912);self.assertEqual(tasks[0]['end'],1999);self.assertEqual(len(tasks),4)
    def test_weighted_mean(self):
        rows=m.summarize(parsed(29,2),2024,'1','cotas');self.assertEqual(m.annual(rows,'cotas',dt.date(2026,1,1))[0]['valor'],2)
    def test_error_preserves_and_checkpoints(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);m.write(root/'catalog/MT.json',{'stations':[dict(code='1657000',candidate_variables=['chuva'],periods={'PeriodoPluviometroInicio':'2024','PeriodoPluviometroFim':'2024'})]})
            def fail(*args,**kwargs):raise ValueError('failure')
            args=SimpleNamespace(root=tmp,budget=1,max_seconds=20,max_mib=10,delay=0)
            status=m.run(args,request=fail,today=dt.date(2026,1,1));self.assertEqual(status['requests_this_run'],1);self.assertEqual(status['tasks_completed'],0);self.assertTrue((root/'monthly-state.json').exists())
    def test_success_no_repeat_same_month(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);m.write(root/'catalog/MT.json',{'stations':[dict(code='1657000',candidate_variables=['chuva'],periods={'PeriodoPluviometroInicio':'2026','PeriodoPluviometroFim':'2026'})]})
            args=SimpleNamespace(root=tmp,budget=2,max_seconds=20,max_mib=10,delay=0)
            request=lambda *a,**kw:b'<DataSet><NewDataSet /></DataSet>'
            today=dt.date.today();self.assertEqual(m.run(args,request=request,today=today)['success_this_run'],2)
            self.assertEqual(m.run(args,request=request,today=today)['requests_this_run'],0)
    def test_refresh_not_starved(self):
        base=dict(uf='MT',code='1657000',kind='chuva',level='1',start=2020,end=2026)
        old={**base,'start':1900,'end':1909};more={**base,'code':'1657001'}
        state={'tasks':{m.key(base):{'last_success_utc':'2026-10-01','last_attempt_utc':'2026-10-01'}}}
        queue=m.due_queue([old,more,base],state,dt.date(2026,11,8),'2026-11-08')
        self.assertEqual(queue[0],base);self.assertEqual(queue[1],more)
    def test_forward_year_discovered(self):
        station=dict(code='1657000',candidate_variables=['chuva'],periods={'PeriodoPluviometroInicio':'2020'})
        tasks=list(m.tasks({'MT':[station]},dt.date(2027,1,1)))
        self.assertEqual(tasks[0]['end'],2027)
        self.assertTrue(any(t['end']==2027 for t in m.due_queue(tasks,{'tasks':{}},dt.date(2027,1,1),'2027-01-01')))
    def test_unknown_no_1850_sweep(self):
        station=dict(code='1657000',candidate_variables=['cotas','vazao'],periods={})
        tasks=list(m.tasks({'MT':[station]},dt.date(2026,1,1)))
        self.assertEqual(len(tasks),4);self.assertEqual(tasks[0]['start'],2025)
        self.assertTrue(tasks[0]['historical_start_unknown'])
    def test_sparse_empty_ranges(self):
        task=dict(code='1657000',uf='MT',kind='chuva',level='1',start=1900,end=1959)
        rows=[]
        for year in range(1900,1960):rows.extend(m.summarize({'observations':[]},year,'1','chuva'))
        out=m.merge({},rows,task,'2026-11-08',dt.date(2026,11,8))
        self.assertEqual(out['months'],[]);self.assertTrue(out['empty'])
        self.assertEqual(out['checked_ranges'][0]['start'],'1900-01-01')
    def test_split_bound_and_preserve(self):
        task=dict(code='1657000',uf='MT',kind='chuva',level='1',start=1900,end=1959)
        children=m.split_task(task);self.assertEqual(len(children),6)
        state={'tasks':{m.key(task):{'split_tasks':children}}}
        self.assertEqual(m.expanded_tasks([task],state),children)
    def test_both_levels_one_request(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);m.write(root/'catalog/MT.json',{'stations':[dict(code='1657000',candidate_variables=['chuva'],periods={'PeriodoPluviometroInicio':'2026','PeriodoPluviometroFim':'2026'})]})
            args=SimpleNamespace(root=tmp,budget=2,max_seconds=20,max_mib=10,delay=0)
            xml=b'<DataSet>'+b''.join(b'<SerieHistorica><EstacaoCodigo>1657000</EstacaoCodigo><NivelConsistencia>'+level+b'</NivelConsistencia><DataHora>2026-01-01</DataHora><Chuva01>1</Chuva01><Chuva01Status>1</Chuva01Status></SerieHistorica>' for level in (b'1',b'2'))+b'</DataSet>'
            status=m.run(args,request=lambda *a,**k:xml,today=dt.date.today())
            self.assertEqual(status['requests_this_run'],1)
            self.assertTrue((root/'summaries/chuva/1657000/nivel2.json').exists())
    def test_split_inherits_cooldown(self):
        task=dict(uf='MT',code='1657000',kind='chuva',level='1',start=1960,end=2026)
        state={'tasks':{m.key(task):{'split_tasks':m.split_task(task),'retry_after':'2026-11-09T12:00:00+00:00'}}}
        expanded=m.expanded_tasks([task],state)
        self.assertEqual(m.due_queue(expanded,state,dt.date(2026,11,8),'2026-11-08T13:00:00+00:00'),[])
        self.assertTrue(m.due_queue(expanded,state,dt.date(2026,11,9),'2026-11-09T13:00:00+00:00'))
if __name__=='__main__':unittest.main()
