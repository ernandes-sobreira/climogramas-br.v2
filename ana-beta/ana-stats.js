(() => {
  "use strict";

  const finite = xs => xs.filter(Number.isFinite);
  const mean = xs => { const a=finite(xs); return a.length ? a.reduce((s,v)=>s+v,0)/a.length : NaN; };
  const median = xs => { const a=finite(xs).sort((a,b)=>a-b); if(!a.length) return NaN; const m=Math.floor(a.length/2); return a.length%2?a[m]:(a[m-1]+a[m])/2; };
  const sd = xs => { const a=finite(xs); if(a.length<2) return NaN; const m=mean(a); return Math.sqrt(a.reduce((s,v)=>s+(v-m)**2,0)/(a.length-1)); };
  const percentile = (xs,p) => {
    const a=finite(xs).sort((a,b)=>a-b); if(!a.length) return NaN;
    const i=(a.length-1)*p, lo=Math.floor(i), hi=Math.ceil(i);
    return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(i-lo);
  };

  function linear(xs, ys){
    const pts=xs.map((x,i)=>[x,ys[i]]).filter(([x,y])=>Number.isFinite(x)&&Number.isFinite(y));
    if(pts.length<2) return null;
    const n=pts.length, xb=mean(pts.map(p=>p[0])), yb=mean(pts.map(p=>p[1]));
    let ssxx=0, ssxy=0, ssyy=0;
    for(const [x,y] of pts){ ssxx+=(x-xb)**2; ssxy+=(x-xb)*(y-yb); ssyy+=(y-yb)**2; }
    if(!ssxx) return null;
    const slope=ssxy/ssxx, intercept=yb-slope*xb;
    let ssres=0; for(const [x,y] of pts) ssres+=(y-(intercept+slope*x))**2;
    return {slope,intercept,r2:ssyy?1-ssres/ssyy:NaN,predict:x=>intercept+slope*x};
  }

  function erf(x){
    const sign=x<0?-1:1, ax=Math.abs(x);
    const t=1/(1+0.3275911*ax);
    const y=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-ax*ax);
    return sign*y;
  }
  const normalCdf = z => 0.5*(1+erf(z/Math.sqrt(2)));

  function mannKendall(values){
    const x=finite(values); const n=x.length;
    if(n<8) return null;
    let S=0;
    for(let i=0;i<n-1;i++) for(let j=i+1;j<n;j++) S += Math.sign(x[j]-x[i]);
    const counts=new Map(); for(const v of x) counts.set(v,(counts.get(v)||0)+1);
    let tie=0; for(const t of counts.values()) if(t>1) tie += t*(t-1)*(2*t+5);
    const varS=(n*(n-1)*(2*n+5)-tie)/18;
    if(!(varS>0)) return null;
    const z=S>0?(S-1)/Math.sqrt(varS):S<0?(S+1)/Math.sqrt(varS):0;
    const p=2*(1-normalCdf(Math.abs(z)));
    const tau=S/(0.5*n*(n-1));
    return {S,z,p,tau,n};
  }

  function senSlope(xs,ys){
    const pts=xs.map((x,i)=>[x,ys[i]]).filter(([x,y])=>Number.isFinite(x)&&Number.isFinite(y));
    if(pts.length<3) return NaN;
    const slopes=[];
    for(let i=0;i<pts.length-1;i++){
      for(let j=i+1;j<pts.length;j++){
        const dx=pts[j][0]-pts[i][0];
        if(dx!==0) slopes.push((pts[j][1]-pts[i][1])/dx);
      }
    }
    return median(slopes);
  }

  function summarize(values){
    const a=finite(values);
    if(!a.length) return {};
    return {
      n:a.length, mean:mean(a), median:median(a), sd:sd(a),
      min:Math.min(...a), max:Math.max(...a),
      p05:percentile(a,.05), p10:percentile(a,.10), p50:percentile(a,.50),
      p90:percentile(a,.90), p95:percentile(a,.95),
      cv:mean(a)!==0 ? sd(a)/mean(a)*100 : NaN
    };
  }

  window.ANAStats={mean,median,sd,percentile,linear,mannKendall,senSlope,summarize};
})();