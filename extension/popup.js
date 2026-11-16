var NAMES = {sn:"Spine",ar:"Hip & Knee",tr:"Trauma",tu:"Tumors",pe:"Peds",bs:"Basic Sci",hw:"Hand",fa:"Foot & Ankle",
  se:"Shoulder & Elbow",sm:"Sports",ai:"Anat Imaging",mi:"Misc",ix:"Incorrect redo",rn:"Random",multi:"Mixed",
  s20:"OITE 2020",s21:"OITE 2021",s22:"OITE 2022",s23:"OITE 2023",s24:"OITE 2024",s25:"OITE 2025",ok13:"OKU 13",ok14:"OKU 14"};
function today(){var d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");}
// one compact row per quiz: {u: updatedAt, cat, days:{date:[answered, graded, correct]}}
function compact(q){
  var days={};
  Object.keys(q.qs||{}).forEach(function(k){
    var r=q.qs[k]; if(!r.a) return;
    var d=r.d||q.date||"", a=days[d]||(days[d]=[0,0,0]);
    a[0]++; if(r.c===1||r.c===0){ a[1]++; if(r.c===1) a[2]++; }
  });
  return {u:q.updatedAt||0, cat:q.cat||null, days:days};
}
function render(){
  chrome.storage.local.get(null).then(function(st){
    var merged={}, rem=(st.remote&&st.remote.quizzes)||{}, loc=Object.assign({}, st.quizzes||{});
    Object.keys(st).forEach(function(k){ if(k.indexOf("rsq:")===0) loc[k.slice(4)]=st[k]; });
    Object.keys(rem).forEach(function(id){ merged[id]=rem[id]; });
    var remToday=0, t0=today();
    Object.keys(rem).forEach(function(id){ var a=(rem[id].days||{})[t0]; if(a) remToday+=a[0]; });
    var skip={}; ((st.remote&&st.remote.aliases)||[]).forEach(function(id){ skip[id]=1; });
    Object.keys(loc).forEach(function(id){
      // copies read off a Results page are folded into the original quiz by the plan
      if(skip[id] || (loc[id].fromResults && !rem[id])) return;
      var c=compact(loc[id]), r=merged[id];
      if(!r){ merged[id]=c; return; }
      // the same quiz can be split across computers: take the larger count for each day
      var days={};
      Object.keys(r.days||{}).concat(Object.keys(c.days)).forEach(function(d){
        var x=(r.days||{})[d]||[0,0,0], y=c.days[d]||[0,0,0];
        days[d]=[Math.max(x[0],y[0]), Math.max(x[1],y[1]), Math.max(x[2],y[2])];
      });
      merged[id]={u:Math.max(r.u||0,c.u), cat:r.cat||c.cat, days:days};
    });
    var t=today(), n=0, g=0, c=0, all=0, latest=null;
    Object.keys(merged).forEach(function(id){
      var q=merged[id]; if(!latest||(q.u||0)>(latest.u||0)) latest=q;
      Object.keys(q.days||{}).forEach(function(d){ var a=q.days[d]; all+=a[0]; if(d===t){ n+=a[0]; g+=a[1]; c+=a[2]; } });
    });
    // what's left today, from the plan at last sync, less anything answered here since
    var td=st.remote&&st.remote.today, leftEl=document.getElementById("left"), blEl=document.getElementById("blocks");
    if(td && td.date===t){
      var left=Math.max(0, td.left-Math.max(0, n-remToday));
      leftEl.textContent = left===0 ? "done" : left;
      blEl.textContent = (td.blocks||[]).map(function(b){ return b.name+" "+(b.left===0?"✓":b.left); }).join(" · ");
      blEl.hidden=!(td.blocks||[]).length;
    } else { leftEl.textContent="—"; blEl.textContent="Open the popup again after a sync to see today's blocks."; blEl.hidden=false; }
    document.getElementById("today").textContent=n;
    document.getElementById("pct").textContent=g?Math.round(100*c/g)+"%":"—";
    document.getElementById("all").textContent=all;
    document.getElementById("cur").textContent=latest?(NAMES[latest.cat]||"untagged"):"—";
    document.getElementById("sync").textContent=st.lastSync?new Date(st.lastSync).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"}):"never";
  });
}
render();
chrome.storage.onChanged.addListener(function(ch, area){ if(area==="local" && (ch.quizzes||ch.remote||ch.lastSync||Object.keys(ch).some(function(k){ return k.indexOf("rsq:")===0; }))) render(); });
// opening the popup pulls in what other devices logged (at most every 5 min)
try{ chrome.runtime.sendMessage({type:"pull", minGapMin:5}); }catch(e){}
chrome.storage.local.get("bgSync").then(function(st){
  var b=document.getElementById("bg"); b.checked = st.bgSync!==false;
  b.addEventListener("change", function(){ chrome.storage.local.set({bgSync:b.checked}); });
});

// ---------- Orthobullets (kept separate from the ResStudy log) ----------
function obRender(){
  chrome.storage.local.get("obQuestions").then(function(st){
    var all=st.obQuestions||{}, t=today(), n=0, g=0, c=0, tot=0, miss=0;
    Object.keys(all).forEach(function(k){
      var q=all[k]; tot++; if(q.result==="incorrect") miss++;
      if(q.date===t){ n++; if(q.result){ g++; if(q.result==="correct") c++; } }
    });
    document.getElementById("obToday").textContent=n;
    document.getElementById("obPct").textContent=g?Math.round(100*c/g)+"%":"—";
    document.getElementById("obAll").textContent=tot+" / "+miss;
  });
}
function obSave(name, text, type){
  var a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([text],{type:type}));
  a.download=name; document.body.appendChild(a); a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function esc(s){ return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\t/g," ").replace(/\r?\n/g,"<br>"); }
// Anki import file: one basic card per missed question (front = stem + choices, back = answer + explanation).
document.getElementById("obAnki").addEventListener("click", function(e){
  e.preventDefault();
  chrome.storage.local.get("obQuestions").then(function(st){
    var all=st.obQuestions||{}, rows=["#separator:tab","#html:true","#tags column:3"];
    Object.keys(all).map(function(k){ return all[k]; }).filter(function(q){ return q.result==="incorrect"; })
      .sort(function(a,b){ return (a.firstAt||"")<(b.firstAt||"")?-1:1; })
      .forEach(function(q){
        var ch=(q.choices||[]).map(function(x){ return x.n+". "+esc(x.text); }).join("<br>");
        var right=(q.choices||[])[(q.correct||0)-1], pick=(q.choices||[])[(q.selected||0)-1];
        var front=esc(q.stem)+"<br><br>"+ch;
        var back="<b>"+(right?right.n+". "+esc(right.text):"")+"</b>"+(pick?"<br><i>You picked "+pick.n+". "+esc(pick.text)+"</i>":"")+
                 "<br><br>"+esc(q.explanation)+"<br><br><small>Orthobullets QID "+esc(q.qid)+(q.topic&&q.topic.length?" · "+esc(q.topic.join(" › ")):"")+"</small>";
        var tags="orthobullets "+((q.topic&&q.topic[0])||"").replace(/[^A-Za-z0-9]+/g,"_");
        rows.push(front+"\t"+back+"\t"+tags.trim());
      });
    obSave("orthobullets-missed-"+today()+".txt", rows.join("\n"), "text/plain");
  });
});
document.getElementById("obJson").addEventListener("click", function(e){
  e.preventDefault();
  chrome.storage.local.get("obQuestions").then(function(st){
    var all=st.obQuestions||{}, list=Object.keys(all).map(function(k){ var q=Object.assign({},all[k]); delete q.__sig; return q; });
    obSave("orthobullets-log-"+today()+".json", JSON.stringify(list,null,2), "application/json");
  });
});
obRender();
chrome.storage.onChanged.addListener(function(ch, area){ if(area==="local" && ch.obQuestions) obRender(); });
