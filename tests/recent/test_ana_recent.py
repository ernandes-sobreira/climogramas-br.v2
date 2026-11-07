import datetime as dt,importlib.util,json,pathlib,tempfile,unittest
from unittest import mock
ROOT=next(p for p in pathlib.Path(__file__).resolve().parents if (p/'scripts/sync_ana_recent.py').exists());FIX=pathlib.Path(__file__).resolve().parent/'fixtures'
s=importlib.util.spec_from_file_location('recent',ROOT/'scripts/sync_ana_recent.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
NOW=dt.datetime(2026,11,7,20,tzinfo=dt.timezone.utc)
class RecentTests(unittest.TestCase):
 def test_catalog_codes_duplicates_active_foreign(self):
  c=m.parse_catalog((FIX/'catalog-sample.xml').read_bytes(),m.iso(NOW));by={x['code']:x for x in c['stations']};self.assertEqual(len(by),3);self.assertIn('00047008',by);self.assertEqual(by['00047008']['uf'],'PA');self.assertEqual(by['10075000']['uf'],None);self.assertTrue(by['10100000']['active']);self.assertGreaterEqual(len(by['10100000']['origins']),2)
 def test_real_level_flow_rawtime_no_rainfall(self):
  x=m.parse_series((FIX/'66070004.xml').read_bytes(),'66070004',m.iso(NOW),'2026-11-06','2026-11-07');self.assertEqual(len(x['records']),153);self.assertEqual(x['latest']['level_cm'],{'datetime_raw':'2026-11-07 15:00:00','value':124});self.assertEqual(x['latest']['flow_m3_s']['value'],253.79);self.assertNotIn('Z',x['records'][-1]['datetime_raw']);self.assertNotIn('Chuva',json.dumps(x));
 def test_missing_level_is_not_zero(self):
  x=m.parse_series((FIX/'67100000.xml').read_bytes(),'67100000',m.iso(NOW));self.assertEqual(len(x['records']),149);self.assertIsNone(x['latest']['level_cm']);self.assertTrue(all(r['level_cm']is None for r in x['records']))
 def test_conflicts_zero_sentinels_invaliddates(self):
  def row(time,level,code='66070004'):return f'<DadosHidrometereologicos><CodEstacao>{code}</CodEstacao><DataHora>{time}</DataHora><Nivel>{level}</Nivel><Vazao>0</Vazao></DadosHidrometereologicos>'
  xml='<DataTable>'+row('2026-11-07 10:00:00','0')+row('2026-11-07 10:00:00','0')+row('2026-11-07 11:00:00','1')+row('2026-11-07 11:00:00','2')+row('2026-02-30 11:00:00','4')+row('2026-11-07 12:00:00','-999.1')+'</DataTable>'
  x=m.parse_series(xml,'66070004',m.iso(NOW));self.assertEqual(len(x['records']),2);self.assertEqual(x['records'][0]['level_cm'],0);self.assertIsNone(x['records'][1]['level_cm']);self.assertEqual(x['quality']['conflicts'],1);self.assertEqual(x['quality']['duplicate_rows'],1);self.assertEqual(x['quality']['invalid_datetime'],1)
 def test_rotation_budget_failure_preserves_snapshot(self):
  with tempfile.TemporaryDirectory()as tmp:
   base=pathlib.Path(tmp);m.save(base/'catalog.json',{'schema_version':1,'checked_at':m.iso(NOW),'stations':[{'code':'66070004','uf':'MT'},{'code':'67100000','uf':'MS'},{'code':'10075000','uf':None}]})
   calls=[]
   def fetch(route,params,limit):calls.append(params['codEstacao']);return (FIX/(params['codEstacao']+'.xml')).read_bytes()
   a=m.sync(base,1,NOW,fetch);self.assertEqual(calls,['66070004']);self.assertEqual(a['cursor'],1);self.assertEqual(a['catalog_brazil_stations'],2);before=(base/'stations/66070004.json').read_bytes()
   b=m.sync(base,1,NOW+dt.timedelta(hours=1),fetch);self.assertEqual(calls,['66070004','67100000']);self.assertEqual(b['cursor'],0)
   def failure(*args):raise TimeoutError()
   c=m.sync(base,1,NOW+dt.timedelta(hours=2),failure);self.assertEqual(c['failed_this_run'],['66070004']);self.assertEqual((base/'stations/66070004.json').read_bytes(),before);self.assertEqual(c['stations']['66070004']['last_success_utc'],a['stations']['66070004']['last_success_utc'])
 def test_empty_response_preserves_prior_measurements(self):
  with tempfile.TemporaryDirectory()as tmp:
   base=pathlib.Path(tmp);m.save(base/'catalog.json',{'checked_at':m.iso(NOW),'stations':[{'code':'66070004','uf':'MT'}]})
   m.sync(base,1,NOW,lambda *args:(FIX/'66070004.xml').read_bytes());old=(base/'stations/66070004.json').read_bytes();s=m.sync(base,1,NOW+dt.timedelta(hours=1),lambda *args:b'<DataTable/>');self.assertEqual((base/'stations/66070004.json').read_bytes(),old);self.assertTrue(s['stations']['66070004']['preserved_previous'])
 def test_storage_cap_keeps_existing_and_advances_rotation(self):
  with tempfile.TemporaryDirectory()as tmp:
   base=pathlib.Path(tmp);m.save(base/'catalog.json',{'checked_at':m.iso(NOW),'stations':[{'code':'66070004','uf':'MT'},{'code':'67100000','uf':'MS'}]})
   fetch=lambda route,params,limit:(FIX/(params['codEstacao']+'.xml')).read_bytes()
   a=m.sync(base,1,NOW,fetch,max_bytes=30_000);self.assertTrue((base/'stations/66070004.json').exists())
   b=m.sync(base,1,NOW,fetch,max_bytes=30_000);self.assertFalse((base/'stations/67100000.json').exists());self.assertEqual(b['storage_limited_this_run'],['67100000']);self.assertEqual(b['cursor'],0)
   c=m.sync(base,1,NOW+dt.timedelta(hours=1),fetch,max_bytes=30_000);self.assertEqual(c['stations']['66070004']['status'],'ok');self.assertGreater(c['cache_bytes'],0)
 def test_shared_ana_cap_prevents_recent_from_overrunning_conventional(self):
  with tempfile.TemporaryDirectory()as tmp:
   root=pathlib.Path(tmp);base=root/'recent';m.save(root/'conventional/large.json',{'data':'x'*30_000});m.save(base/'catalog.json',{'checked_at':m.iso(NOW),'stations':[{'code':'66070004','uf':'MT'}]})
   state=m.sync(base,1,NOW,lambda *args:(FIX/'66070004.xml').read_bytes(),max_bytes=1_000_000,total_max_bytes=40_000);self.assertEqual(state['storage_limited_this_run'],['66070004']);self.assertFalse((base/'stations/66070004.json').exists())
 def test_time_budget_stops_before_new_request(self):
  with tempfile.TemporaryDirectory()as tmp:
   base=pathlib.Path(tmp);m.save(base/'catalog.json',{'checked_at':m.iso(NOW),'stations':[{'code':'66070004','uf':'MT'}]})
   with mock.patch.object(m.time,'monotonic',side_effect=[0,270]):
    state=m.sync(base,20,NOW,lambda *args:self.fail('must not fetch'),max_seconds=300)
   self.assertEqual(state['checked_this_run'],0);self.assertEqual(state['cursor'],0);self.assertTrue(state['time_budget_exhausted'])
if __name__=='__main__':unittest.main()
