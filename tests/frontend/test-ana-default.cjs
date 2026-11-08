const fs=require('fs'),vm=require('vm'),assert=require('assert');const s=fs.readFileSync(__dirname+'/../../app.js','utf8');const helper=s.slice(s.indexOf('  function suggestedAnaYear'),s.indexOf('  function selectAnaStation'));const c={};vm.createContext(c);vm.runInContext(helper,c);assert.equal(c.suggestedAnaYear({start:'1912-01-01',end:'1999-12-31'},2026),1999);assert.equal(c.suggestedAnaYear({},2026),2025);assert.equal(c.suggestedAnaYear({start:'2026-01-01'},2026),2026);assert(s.includes("if(yearStart.dataset.anaSet!=='user')"));assert(s.includes("if(isAna())yearStart.dataset.anaSet='user'"));assert(s.includes('Seu intervalo foi mantido.'));console.log('PASS: historical default, active/new station and explicit user interval preserved');

require("./test-ana-observed.cjs");

require("../test-imported.cjs");
require("./test-imported-integration.cjs");

require("./test-confirmed-meta.cjs");
