import unittest, tempfile, pathlib, os, subprocess
ROOT=next(p for p in pathlib.Path(__file__).resolve().parents if (p/'scripts/request_pages_build.sh').exists())
SHA='a'*40
class Tests(unittest.TestCase):
 def case(self,status):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d);(p/'gh').write_text('#!/bin/sh\nif [ "$2" = "--method" ]; then echo \'{"status":"queued"}\';else echo \'{"status":"'+status+'","commit":"'+SHA+'"}\';fi\n');(p/'gh').chmod(0o755)
   (p/'sleep').write_text('#!/bin/sh\nexit 0\n');(p/'sleep').chmod(0o755)
   env={**os.environ,'PATH':d+':'+os.environ['PATH'],'GITHUB_REPOSITORY':'example/repo','GH_TOKEN':'test-fixture-not-a-token'}
   return subprocess.run(['bash',str(ROOT/'scripts/request_pages_build.sh'),SHA],env=env,text=True,capture_output=True)
 def test_built(self):self.assertEqual(self.case('built').returncode,0)
 def test_failed(self):self.assertEqual(self.case('errored').returncode,1)
 def test_timeout(self):self.assertEqual(self.case('queued').returncode,1)
if __name__=='__main__':unittest.main()
