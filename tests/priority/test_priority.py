import sys,pathlib,unittest,datetime as dt,tempfile
from types import SimpleNamespace
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'tools'))
import sync_ana_monthly as m

def task(i,rank=3,**extra):return dict(uf='MT',code=str(10000+i),kind='chuva',level='1',start=2020,end=2026,priority_rank=rank,**extra)
class PriorityTests(unittest.TestCase):
    def test_radius(self):self.assertEqual(m.station_priority({'lat':-16.076,'lon':-57.681},'MT')[0],1)
    def test_municipality_fallback(self):
        self.assertEqual(m.station_priority({'lat':None,'lon':None,'municipality':'Corumbá'},'MS')[0],2)
        self.assertEqual(m.station_priority({'municipality':"Lambari D’Oeste"},'MT')[0],2)
    def test_bad_coordinates_no_invention(self):
        self.assertEqual(m.station_priority({'lat':'bad','lon':999,'municipality':'Unknown'},'MT')[0],3)
        self.assertEqual(m.station_priority({'municipality':'Cuiabá'},'SP')[0],3)
    def test_national_share_and_secondary_priority(self):
        all_tasks=[task(i,1) for i in range(50)]+[task(100+i,2) for i in range(50)]+[task(200+i,3) for i in range(50)]
        queue=m.due_queue(all_tasks,{'tasks':{}},dt.date(2026,11,8),'2026-11-08')
        self.assertEqual([t['priority_rank'] for t in queue[:10]],[1,1,1,2,3]*2)
        self.assertEqual(sum(t['priority_rank']==3 for t in queue[:100]),20)
    def test_empty_priority_uses_whole_budget(self):
        tasks=[task(i,3) for i in range(100)];self.assertEqual(m.regional_queue(tasks),tasks)
    def test_cooldown_applies_before_priority(self):
        t=task(1,1,not_before='2027-01-01');q=m.due_queue([t,task(2,3)],{'tasks':{}},dt.date(2026,11,8),'2026-11-08')
        self.assertEqual(len(q),1);self.assertEqual(q[0]['priority_rank'],3)
    def test_monthly_refresh_not_starved_in_region(self):
        base=task(1,1);state={'tasks':{m.key(base):{'last_success_utc':'2026-10-01'}}}
        q=m.due_queue([task(2,1),base],state,dt.date(2026,11,8),'2026-11-08');self.assertEqual(q[0],base)
    def test_actual_request_quota_survives_shared_level_skips(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);stations=[];calls=[]
            for i in range(20):
                stations.append(dict(code=str(10000+i),candidate_variables=['chuva'],periods={'PeriodoPluviometroInicio':'2026','PeriodoPluviometroFim':'2026'},lat=-16.076 if i<10 else -10,lon=-57.681 if i<10 else -50))
            m.write(root/'catalog/MT.json',{'stations':stations})
            def response(route,params,**kwargs):
                code=params['codEstacao'];calls.append(code)
                return ('<DataSet>'+''.join('<SerieHistorica><EstacaoCodigo>'+code+'</EstacaoCodigo><NivelConsistencia>'+level+'</NivelConsistencia><DataHora>2026-01-01</DataHora><Chuva01>1</Chuva01><Chuva01Status>1</Chuva01Status></SerieHistorica>' for level in ('1','2'))+'</DataSet>').encode()
            args=SimpleNamespace(root=tmp,budget=10,max_seconds=20,max_mib=350,delay=0,compressed=True)
            m.run(args,request=response,today=dt.date(2026,11,8))
            self.assertEqual(len(calls),10);self.assertEqual(sum(int(c)>=10010 for c in calls),2)
    def test_long_unique_truncated_municipality(self):
        for uf,name in [('MT','SANTO ANTÔNIO DO LE'),('MT','NOSSA SENHORA DO LI'),('MS','RIO VERDE DE MATO G')]:
            self.assertEqual(m.station_priority({'municipality':name},uf),(2,'screening_truncated_name'))
        self.assertEqual(m.station_priority({'municipality':'SANTO ANTÔNIO DE LEVERGER'},'MT')[0],2)
    def test_short_or_ambiguous_prefix_stays_national(self):
        self.assertEqual(m.station_priority({'municipality':'RIO VERDE'},'MS')[0],3)
        original=m.PANTANAL_MUNICIPALITIES['MT']
        try:
            m.PANTANAL_MUNICIPALITIES['MT']=original|{'SANTO ANTONIO DO LEITO'}
            self.assertEqual(m.station_priority({'municipality':'SANTO ANTÔNIO DO LE'},'MT')[0],3)
        finally:m.PANTANAL_MUNICIPALITIES['MT']=original
    def test_radius_before_truncated_municipality(self):
        self.assertEqual(m.station_priority({'lat':-16.076,'lon':-57.681,'municipality':'SANTO ANTÔNIO DO LE'},'MT')[0],1)
if __name__=='__main__':unittest.main()
