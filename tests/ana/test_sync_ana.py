import importlib.util, pathlib, tempfile, unittest, types, json, contextlib, io
ROOT=next(p for p in pathlib.Path(__file__).resolve().parents if (p/'tools/sync_ana.py').exists())
spec=importlib.util.spec_from_file_location('sync',ROOT/'tools/sync_ana.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
FIX=pathlib.Path(__file__).resolve().parent/'fixtures'
class Tests(unittest.TestCase):
 def test_real_inventory(self):
  stations=m.parse_inventory((FIX/'inventario-acre.xml').read_bytes(),'AC');self.assertEqual(len(stations),2);self.assertEqual(sum(x['station_type']=='2' for x in stations),1);self.assertIn('771001',[x['code'] for x in stations])
 def test_real_three_variables(self):
  for kind,code,first in [('chuva','1657003',0),('cotas','66070004',284),('vazao','66070004',468.591)]:
   p=m.parse_series((FIX/f'{kind}-{code}-2000-01.xml').read_bytes(),code,kind,2000);obs=[x for x in p['observations'] if x['consistency']=='2' and x['usable']];self.assertEqual(len(obs),31);self.assertEqual(obs[0]['value'],first)
   if kind=='chuva':self.assertAlmostEqual(sum(x['value'] for x in obs),176.7)
 def test_bad_status_and_conflict(self):
  xml=b'<DataSet><SerieHistorica><EstacaoCodigo>123456</EstacaoCodigo><NivelConsistencia>1</NivelConsistencia><DataHora>2000-02-01</DataHora><Chuva01>0</Chuva01><Chuva01Status>1</Chuva01Status><Chuva02>-999.1</Chuva02><Chuva02Status>1</Chuva02Status><Chuva03>20</Chuva03><Chuva03Status>4</Chuva03Status><Chuva30>2</Chuva30></SerieHistorica></DataSet>'
  r=m.parse_series(xml,'123456','chuva',2000)['observations'];self.assertEqual(len(r),3);self.assertTrue(r[0]['usable']);self.assertFalse(r[1]['usable']);self.assertFalse(r[2]['usable']);self.assertIsNone(r[1]['value'])
 def test_parser_rejects_error_xml(self):
  with self.assertRaises(ValueError):m.parse_series(b'<html>error</html>','123456','chuva',2000)
  with self.assertRaises(ValueError):m.parse_series(b'<!DOCTYPE x><DataSet/>','123456','chuva',2000)
 def test_merge_preserves_empty_and_distinguishes_explicit_correction(self):
  task={'code':'123456','kind':'chuva','uf':'AC','year':2000,'level':'1'}
  obs={'date':'2000-01-01','consistency':'1','value':1,'status':'1','usable':True}
  p={'unit':'mm','matching_month_rows':1,'observations':[obs]};a=m.merge_success({},p,task,'t1');b=m.merge_success(a,p,task,'t2');self.assertEqual(a['observations'],b['observations'])
  e=m.merge_success(a,{'unit':'mm','matching_month_rows':0,'observations':[]},task,'t3');self.assertEqual(e['observations'],a['observations']);self.assertEqual(e['last_result'],'empty_preserved')
  c=m.merge_success(a,{**p,'observations':[{**obs,'value':None,'status':'3','usable':False}]},task,'t4');self.assertFalse(c['observations'][0]['usable']);self.assertIsNone(c['latest_observation_date'])
 def test_national_task_roundrobin(self):
  s=lambda c:{'code':c,'candidate_variables':['chuva']}
  tasks=m.build_tasks({'AC':[s('111111'),s('222222')],'SP':[s('333333')]},[2026]);self.assertEqual([x['uf'] for x in tasks[:4]],['AC','SP','AC','SP'])
 def test_run_persistence_failure_and_no_dataset_timestamp_churn(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);station={'code':'1657003','candidate_variables':['chuva'],'operating':'1'};m.write(root/'catalog/MT.json',{'stations':[station]})
   args=types.SimpleNamespace(output=d,catalog_budget=0,series_budget=1,max_seconds=30,delay_seconds=0,years=[2000])
   def ok(route,params):return (FIX/'chuva-1657003-2000-01.xml').read_bytes()
   with contextlib.redirect_stdout(io.StringIO()):m.run(args,ok)
   path=root/'series/chuva/1657003/2000.json';before=path.read_bytes();view=m.read(root/'series/chuva/1657003/2000-nivel2.json',{})
   self.assertEqual(len(view['items']),31);self.assertEqual(view['items'][1]['Chuva'],3.4);self.assertEqual(view['coverage']['expected_days'],366)
   with contextlib.redirect_stdout(io.StringIO()):m.run(args,ok)
   self.assertEqual(path.read_bytes(),before)
   def fail(*a):raise TimeoutError()
   with contextlib.redirect_stdout(io.StringIO()):status=m.run(args,fail)
   self.assertEqual(path.read_bytes(),before);self.assertEqual(status['tasks_last_error'],1);self.assertEqual(status['catalog_ufs_available'],1);self.assertFalse(status['national_series_complete']);self.assertEqual(m.read(root/'series/chuva/1657003/2000-nivel1-status.json',{})['last_result'],'error_preserved')
 def test_storage_cap_still_refreshes_existing_and_does_not_starve(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);station={'code':'1657003','candidate_variables':['chuva'],'operating':'1'};m.write(root/'catalog/MT.json',{'stations':[station]})
   args=types.SimpleNamespace(output=d,catalog_budget=0,series_budget=1,max_seconds=30,delay_seconds=0,years=[2000],max_cache_mib=350)
   args.series_budget=2
   seen=[]
   def ok(route,params):seen.append(params['codEstacao']);return (FIX/'chuva-1657003-2000-01.xml').read_bytes()
   with contextlib.redirect_stdout(io.StringIO()):m.run(args,ok)
   m.write(root/'catalog/MT.json',{'stations':[station,{**station,'code':'999999'}]});args.max_cache_mib=0;args.series_budget=1;seen.clear()
   with contextlib.redirect_stdout(io.StringIO()):status=m.run(args,ok)
   self.assertEqual(seen,['1657003']);self.assertTrue(status['storage_limited']);self.assertFalse((root/'series/chuva/999999/2000.json').exists())
 def test_adaptive_current_only_and_backoff(self):
  station={'code':'1657003','operating':'1','candidate_variables':['chuva']}
  q,allq=m.adaptive_tasks({'MT':[station]},[2025,2026],{'tasks':{}},'2026-11-07T20:00:00+00:00')
  self.assertEqual(len(q),1);self.assertEqual(q[0]['year'],2026);self.assertEqual(q[0]['level'],'1')
  t=q[0];r={'status':'empty_preserved','last_success_utc':'2026-11-07T20:00:00+00:00','usable_response_count':0}
  m.set_next_due(r,'2026-11-07T20:00:00+00:00',2026)
  state={'tasks':{m.taskkey(t):r}}
  q,allq=m.adaptive_tasks({'MT':[station]},[2025,2026],state,'2026-11-07T21:00:00+00:00')
  self.assertEqual(len(q),1);self.assertEqual(q[0]['year'],2025)
  self.assertTrue(r['next_due_utc'].startswith('2026-12-07'))
 def test_adaptive_positive_does_not_starve_discovery(self):
  stations=[{'code':str(1657000+i),'operating':'1','candidate_variables':['chuva']} for i in range(4)]
  state={'tasks':{}}
  for s in stations[:2]:state['tasks'][f"MT:{s['code']}:chuva:2026:1"]={'usable_response_count':31,'last_attempt_utc':'2026-10-01T00:00:00+00:00'}
  q,_=m.adaptive_tasks({'MT':stations},[2026],state,'2026-11-07T20:00:00+00:00')
  self.assertEqual([x['code'] for x in q],[stations[i]['code'] for i in (0,2,1,3)])
 def test_adaptive_error_backoff_and_catalog_retry(self):
  r={'status':'error'};m.set_next_due(r,'2026-11-07T00:00:00+00:00',2026)
  self.assertEqual(r['next_due_utc'],'2026-11-07T03:00:00+00:00')
  m.set_next_due(r,'2026-11-07T03:00:00+00:00',2026)
  self.assertEqual(r['next_due_utc'],'2026-11-07T09:00:00+00:00')
  with tempfile.TemporaryDirectory() as d:
   args=types.SimpleNamespace(output=d,catalog_budget=1,series_budget=0,max_seconds=30,delay_seconds=0,years=[2026],adaptive=True)
   def fail(*a):raise TimeoutError()
   with contextlib.redirect_stdout(io.StringIO()):m.run(args,fail)
   status=m.read(pathlib.Path(d)/'status.json',{});rec=status['catalog_status']['AC']
   self.assertEqual(rec['consecutive_failures'],1);self.assertGreater(rec['next_due_utc'],rec['last_attempt_utc'])
if __name__=='__main__':unittest.main()
