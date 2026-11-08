import importlib.util,pathlib,unittest,datetime as dt
s=importlib.util.spec_from_file_location('planner',pathlib.Path(__file__).resolve().parents[1]/'tools/plan_inmet_years.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class PlanTest(unittest.TestCase):
 def test_empty_selects_only_two(self):self.assertEqual(m.plan({},2026,dt.datetime(2026,11,7,tzinfo=dt.timezone.utc)),[2025,2026])
 def test_success_advances(self):self.assertEqual(m.plan({'years':[{'year':2025,'source_sha256':'a','stations':634}]},2026,dt.datetime.now(dt.timezone.utc)),[2024,2026])
 def test_recent_failure_rotates(self):self.assertEqual(m.plan({'years':[{'year':2025,'checked_utc':'2026-11-07T00:00:00+00:00'}]},2026,dt.datetime(2026,11,7,tzinfo=dt.timezone.utc)),[2024,2026])
 def test_all_complete_only_current(self):self.assertEqual(m.plan({'years':[{'year':y,'source_sha256':'a','stations':1} for y in range(2000,2026)]},2026,dt.datetime.now(dt.timezone.utc)),[2026])
 def test_previous_review_never_three(self):self.assertEqual(m.plan({},2026,dt.datetime.now(dt.timezone.utc),include_previous=True),[2025,2026])
class PriorityTest(unittest.TestCase):
 def setUp(self):
  self.now=dt.datetime(2026,11,8,tzinfo=dt.timezone.utc)
  self.status={'years':[{'year':2025,'source_sha256':'a','stations':594}]}
  self.present=set(range(2000,2019))|{2023,2024,2025,2026}
 def test_missing_before_existing_without_sha(self):
  self.assertEqual(m.plan(self.status,2026,self.now,present_years=self.present),[2022,2026])
 def test_four_gaps_in_order(self):
  for y in [2022,2021,2020,2019]:
   self.assertEqual(m.plan(self.status,2026,self.now,present_years=self.present),[y,2026])
   self.status['years'].append({'year':y,'source_sha256':'a','stations':1})
  self.assertEqual(m.plan(self.status,2026,self.now,present_years=self.present),[2024,2026])
 def test_failure_rotates_gaps(self):
  self.status['years'].append({'year':2022,'checked_utc':self.now.isoformat()})
  self.assertEqual(m.plan(self.status,2026,self.now,present_years=self.present),[2021,2026])
 def test_monthly_previous_bounded(self):
  self.assertEqual(m.plan(self.status,2026,self.now,include_previous=True,present_years=self.present),[2025,2026])
 def test_one_pack_not_completion(self):
  allpresent=set(range(2000,2027))
  self.assertEqual(m.plan(self.status,2026,self.now,present_years=allpresent),[2024,2026])
 def test_old_year_not_abandoned(self):
  complete={'years':[{'year':y,'source_sha256':'a','stations':1} for y in range(2001,2026)]}
  self.assertEqual(m.plan(complete,2026,self.now,present_years=self.present),[2000,2026])
if __name__=='__main__' :unittest.main()
