import importlib.util,pathlib,unittest,datetime as dt
s=importlib.util.spec_from_file_location('planner',pathlib.Path(__file__).resolve().parents[1]/'tools/plan_inmet_years.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class PlanTest(unittest.TestCase):
 def test_empty_selects_only_two(self):self.assertEqual(m.plan({},2026,dt.datetime(2026,11,7,tzinfo=dt.timezone.utc)),[2025,2026])
 def test_success_advances(self):self.assertEqual(m.plan({'years':[{'year':2025,'source_sha256':'a','stations':634}]},2026,dt.datetime.now(dt.timezone.utc)),[2024,2026])
 def test_recent_failure_rotates(self):self.assertEqual(m.plan({'years':[{'year':2025,'checked_utc':'2026-11-07T00:00:00+00:00'}]},2026,dt.datetime(2026,11,7,tzinfo=dt.timezone.utc)),[2024,2026])
 def test_all_complete_only_current(self):self.assertEqual(m.plan({'years':[{'year':y,'source_sha256':'a','stations':1} for y in range(2019,2026)]},2026,dt.datetime.now(dt.timezone.utc)),[2026])
 def test_previous_review_never_three(self):self.assertEqual(m.plan({},2026,dt.datetime.now(dt.timezone.utc),include_previous=True),[2025,2026])
if __name__=='__main__':unittest.main()
