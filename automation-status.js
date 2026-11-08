(()=>{
'use strict';
const base=new URL('assets/',document.currentScript.src);
const read=async p=>{try{const r=await fetch(new URL(p,base),{cache:'no-store'});return r.ok?await r.json():null;}catch{return null;}};
let fingerprint=null;
async function refresh(){
 const el=document.getElementById('automationStatus');if(!el)return;
 const [ana,inmet,recent,monthly]=await Promise.all([read('ana/status.json'),read('inmet-update-status.json'),read('ana/recent/status.json'),read('ana/monthly-status.json')]);
 const parts=[];
 if(inmet)parts.push(`INMET: ${inmet.status||'verificado'}; verificação ${inmet.checked_utc||inmet.updated_utc||'não informada'}.`);
 if(ana)parts.push(`ANA histórica: ${ana.catalog_ufs_available||0}/27 catálogos estaduais persistidos; ${ana.tasks_with_usable_observations??0} tarefas com observações válidas, de ${ana.task_count||0} tarefas na fila. Última execução ${ana.last_run_utc||'não informada'}.`);
 if(monthly)parts.push(`ANA pré-calculada: ${monthly.archive_useful_stations??'contagem em preparação'} estações com dados úteis; ${monthly.requests_this_run??0} consultas no último lote, ${monthly.success_this_run??0} respostas válidas. Coleta ${monthly.last_run_utc||'não informada'}. Carga nacional ainda por etapas.`);
 if(monthly?.storage_limited)parts.push('Resumos ANA: limite de armazenamento atingido; acervo anterior preservado e expansão pendente.');
 if(monthly?.metrics_read_errors)parts.push('Resumos ANA: alguns arquivos não puderam ser auditados nesta execução.');
 if(ana?.storage_limited)parts.push('ANA: limite de armazenamento atingido; novas séries podem não ser salvas.');
 if(ana?.tasks_last_error)parts.push(`ANA: ${ana.tasks_last_error} tarefas com erro na última tentativa, preservando dados anteriores.`);
 if(!ana)parts.push('ANA histórica: primeira coleta persistente ainda não disponível.');
 if(recent)parts.push(`Telemetria: última execução ${recent.last_attempt_utc||'não informada'}. Consulte a data da medição, não apenas a data da coleta.`);
 if(recent?.failed_this_run?.length)parts.push(`Telemetria: ${recent.failed_this_run.length} consultas falharam nesta execução.`);
 if(recent?.storage_limited_this_run?.length)parts.push('Telemetria: expansão do cache limitada.');
 if(recent?.catalog_error)parts.push('Telemetria: falha ao atualizar catálogo; catálogo anterior preservado.');
 if(recent?.time_budget_exhausted)parts.push('Telemetria: orçamento desta execução atingido; fila continua na próxima.');
 parts.push('Atualização incremental: estação ainda não coletada usa consulta direta. A rotina não cria medições que a fonte não disponibiliza.');
 el.textContent=parts.join(' ');
 const next=JSON.stringify([monthly?.last_run_utc,ana?.last_success_utc,inmet?.years?.map(x=>[x.year,x.source_sha256,x.processed_utc])||inmet?.updated_utc,recent?.last_success_utc]);
 if(fingerprint!==null&&fingerprint!==next)window.dispatchEvent(new CustomEvent('climogramas-data-updated'));
 fingerprint=next;
}
window.ClimogramasAutomation={refresh};refresh();setInterval(()=>{if(document.visibilityState==='visible')refresh();},5*60*1000);
})();

