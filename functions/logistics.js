'use strict';
const { completionDurations } = require('./durations');
const RETURN_WINDOW=300000;
const MAX_ROUTE_STOPS=20;
const actions=new Set(['getCapabilities','requestReturn','releaseReturn','cancelReturn','createRoute','joinRoute','leaveRoute','publishRoute','releaseRoute','dissolveRoute','routePickup','finishRouteStop','publishDraft','discardDraft','cancelRoute']);
const inProgress=o=>o&&o.status==='run';
function put(state,path,value){const parts=path.split('/');const leaf=parts.pop();let node=state;for(const part of parts)node=node[part]||=( {} );if(value===null)delete node[leaf];else node[leaf]=value;}
function complete(o,who,uid,now){Object.assign(o,{status:'done',completed:now,...completionDurations(o,now),paid:false,paymentStatus:'pending',paymentSchemaVersion:2,location:null});if(who.pix)o.paymentPix={...who.pix};}
function careFor(state,o){
 if(o.kind!=='route')return {fragile:o.fragile===true,importantNotes:o.importantNotes===true,notes:o.fragile||o.importantNotes?o.notes||'':'',revision:Number(o.revision||0)};
 const stops=o.routeOrderIds.map(id=>state.orders[id]);
 return {fragile:stops.some(s=>s.fragile),importantNotes:stops.some(s=>s.importantNotes),notes:stops.filter(s=>s.fragile||s.importantNotes).map(s=>'ENTREGA '+s.routeSequence+' · '+s.clientNeighborhood+(s.fragile?' · FRÁGIL':'')+(s.notes?'\n'+s.notes:'')).join('\n\n'),revision:Number(o.revision||0)};
}
function linkRoundtrip(state,id,o,previous,completing,ctx,a){
 const {fail,commit}=a;const {now,uid,requestId}=ctx;
 if(o.serviceType!=='roundtrip'||o.status==='cotacao')return;
 // Legacy roundtrips keep their contracted value and original execution flow.
 if(previous&&!completing&&!previous.roundtripSchema)return;
 const secondId=previous?.returnOrderId||id+'_return';
 const old=state.orders?.[secondId];
 fail(!old||['awaiting_return','awaiting_quote_return'].includes(old.status),'A devolução já foi solicitada.');
 let firstFee,secondFee,total;
 if(previous?.roundtripSchema&&!completing){firstFee=previous.fee;secondFee=old.fee;total=Math.round((firstFee+secondFee)*100)/100;}
 else if(completing){const cents=Math.round(o.fee*100);fail(cents>=2,'A cotação deve cobrir as duas viagens.');firstFee=Math.floor(cents/2)/100;secondFee=(cents-Math.floor(cents/2))/100;total=cents/100;}
 else{firstFee=o.fee;secondFee=o.fee;total=Math.round(o.fee*200)/100;}
 Object.assign(o,{serviceType:'collection',roundtripSchema:1,roundtripGroupId:id,legNumber:1,returnOrderId:secondId,roundtripTotalFee:total,fee:firstFee});
 if(completing)o.agreedFee=firstFee;
 const second={...o,id:undefined,orderCode:o.orderCode+'-VOLTA',serviceType:'delivery',legNumber:2,firstOrderId:id,status:'awaiting_return',fee:secondFee,created:old?.created||now,revision:old?.revision||0,offerGeneration:0,paid:false};
 for(const field of ['id','returnOrderId','courierId','assignedCourierId','courierName','accepted','picked','tripStage','queuePosition','location','bids','trackingToken','trackingExpiresAt','quoteAcceptedAt','careAcknowledgedAt','careAcknowledgedBy'])delete second[field];
 if(o.agreedFee!==undefined)second.agreedFee=secondFee;else delete second.agreedFee;
 if(second.priceSnapshot)second.priceSnapshot={...second.priceSnapshot,fee:secondFee};
 commit(state,secondId,second,old,now,uid,'prepare-return',requestId);
}
function expireReturns(state,now,a){let changed=false;for(const [id,timer]of Object.entries(state.returnTimers||{})){
 if(timer.until>now)continue;
 const o=state.orders?.[id];a.put(state,'returnTimers/'+id,null);changed=true;
 if(o?.status==='return_priority'&&o.priorityUntil<=now){const before=structuredClone(o);o.status='open';o.offerGeneration=Number(o.offerGeneration||0)+1;o.priorityReleasedAt=now;o.priorityReleaseReason='timeout';a.commit(state,id,o,before,now,'server','return-timeout','timer_'+timer.until);changed=true;}
 }return changed;}
function afterOrder(state,id,o,previous,ctx,a){
 if(!o.roundtripSchema||o.legNumber!==1)return;
 const second=state.orders?.[o.returnOrderId];if(!second)return;
 if(['cancelled','cancelado_cotacao'].includes(o.status)&&['awaiting_return','awaiting_quote_return'].includes(second.status)){
  const before=structuredClone(second);Object.assign(second,{status:'cancelled',cancelledAt:ctx.now,cancelledBy:ctx.uid});a.commit(state,o.returnOrderId,second,before,ctx.now,ctx.uid,'cancel-return',ctx.requestId);
 }
 if(o.status==='cotacao'&&previous?.status!=='cotacao'){
  const before=structuredClone(second);Object.assign(second,{status:'awaiting_quote_return',fee:0,roundtripTotalFee:0});delete second.agreedFee;
  o.serviceType='roundtrip';o.roundtripTotalFee=0;
  a.commit(state,o.returnOrderId,second,before,ctx.now,ctx.uid,'requote-return',ctx.requestId);
 }
}
function storeRouteProjection(state,route,storeId,id=route.id){
 const stopIds=(route.routeOrderIds||[]).filter(stopId=>state.orders?.[stopId]?.storeId===storeId);
 if(!stopIds.length)return null;
 const stops=stopIds.map(stopId=>state.orders[stopId]);
 const pickup=(route.routePickups||[]).find(item=>item.storeId===storeId);
 const view={...route,id,storeId,storeName:stops[0].storeName,storeAddress:pickup?.address||stops[0].storeAddress,clientNeighborhood:stops.map(stop=>stop.clientNeighborhood).join(' · '),routeOrderIds:stopIds,routeValues:stops.map(stop=>({neighborhood:stop.clientNeighborhood,fee:stop.fee})),fee:stops.reduce((sum,stop)=>sum+Math.round(Number(stop.fee||0)*100),0)/100,deliveryCount:Number(route.deliveryCount||stopIds.length),routeOwner:route.storeId===storeId,routeHasAnyPickup:Object.keys(route.routePickupStoreIds||{}).length>0,routePickups:pickup?[{name:pickup.name,address:pickup.address}]:[],pickupStoreIds:[storeId]};
 view.routePickupStoreIds=route.routePickupStoreIds?.[storeId]?{[storeId]:route.routePickupStoreIds[storeId]}:{};
 for(const field of ['routeStoreIds','allowOtherStores','sharedRoute'])delete view[field];
 return view;
}
function syncStoreRouteViews(state,route,id=route.id){
 const storeIds=new Set([route.storeId,...Object.keys(route.routeStoreIds||{})]);
 for(const storeId of storeIds){const view=storeRouteProjection(state,route,storeId,id);put(state,`storeOrders/${storeId}/${id}`,view);}
}
function dispatch(state,uid,who,action,id,input,ctx,a){
 const {fail,key,put,commit,projectOrder,courierSlots}=a;const now=ctx.now;let o=id?state.orders?.[id]:null;
 const owner=()=>fail(who?.role==='store'&&o?.storeId===uid,'Pedido de outra loja.','permission-denied');
 const rider=()=>fail(who?.role==='courier'&&o?.courierId===uid,'Corrida de outro motoboy.','permission-denied');
 const change=(targetId,target,before,what=action)=>commit(state,targetId,target,before,now,uid,what,ctx.requestId);
 if(action==='getCapabilities')return {ok:true,logisticsVersion:1,maxRouteStops:MAX_ROUTE_STOPS,returnPriorityMs:RETURN_WINDOW};
 if(action==='createRoute'){
  fail(who?.role==='store','Somente lojistas criam rotas.','permission-denied');
  fail(Array.isArray(input.orderIds)&&input.orderIds.length>=2&&input.orderIds.length<=MAX_ROUTE_STOPS,'Selecione de 2 a '+MAX_ROUTE_STOPS+' entregas.');
  const ids=input.orderIds.map(x=>key(x));fail(new Set(ids).size===ids.length,'Entrega repetida na rota.');
  const stops=ids.map(k=>state.orders?.[k]);
  for(const stop of stops)fail(stop&&stop.storeId===uid&&stop.serviceType==='delivery'&&!stop.roundtripSchema&&!stop.routeId&&!stop.kind&&['open','route_draft'].includes(stop.status)&&!stop.courierId&&!stop.assignedCourierId,'Use entregas simples da mesma loja, sem motoboy e fora de outras rotas.');
  fail(stops.every(s=>s.serviceDate===stops[0].serviceDate),'Agrupe entregas da mesma data.');
  fail(stops.every(s=>s.storeAddress===stops[0].storeAddress),'As entregas devem ter o mesmo ponto de coleta.');
  const routeId=ctx.newId;const fee=stops.reduce((sum,s)=>sum+Math.round(s.fee*100),0)/100;
  const route={id:routeId,kind:'route',orderCode:'ROTA-'+routeId.slice(-8).toUpperCase(),storeId:uid,storeName:who.name,storeAddress:stops[0].storeAddress,status:input.allowOtherStores===true?'route_collecting':'route_open',allowOtherStores:input.allowOtherStores===true,sharedRoute:input.allowOtherStores===true,routeStoreIds:{[uid]:true},routePickups:[{storeId:uid,name:who.name,address:stops[0].storeAddress}],pickupStoreIds:[uid],routePickupStoreIds:{},serviceType:'route',serviceDate:stops[0].serviceDate,city:stops[0].city,clientNeighborhood:stops.map(s=>s.clientNeighborhood).join(' · '),routeOrderIds:ids,deliveryCount:ids.length,completedStops:0,routeValues:stops.map(s=>({neighborhood:s.clientNeighborhood,fee:s.fee})),fee,fragile:stops.some(s=>s.fragile),importantNotes:stops.some(s=>s.importantNotes),created:now,revision:0,offerGeneration:input.allowOtherStores===true?0:1};
  ids.forEach((stopId,index)=>{const stop=stops[index],before=structuredClone(stop);Object.assign(stop,{routeId,routeSequence:index+1,routeOriginalStatus:stop.status,status:'grouped'});change(stopId,stop,before,'group-route');});
  change(routeId,route,null);const result={ok:true,orderId:routeId};if(input.allowOtherStores===true)result.routeCode=routeId;return result;
 }
 if(action==='joinRoute'){
  fail(who?.role==='store','Somente lojistas podem incluir entregas em uma rota.','permission-denied');
  const routeId=key(input.routeId,'Código da rota'),route=state.orders?.[routeId];
  fail(route?.kind==='route'&&route.status==='route_collecting'&&route.allowOtherStores===true,'Código inválido ou rota encerrada.');
  fail(route.storeId!==uid,'A loja criadora não pode entrar novamente.');
  fail(!route.routeStoreIds?.[uid],'Esta loja já incluiu entregas nesta rota.');
  fail(Array.isArray(input.orderIds)&&input.orderIds.length>=1&&input.orderIds.length<=MAX_ROUTE_STOPS,'Selecione ao menos uma entrega.');
  const ids=input.orderIds.map(value=>key(value));fail(new Set(ids).size===ids.length,'Entrega repetida na rota.');
  fail(route.routeOrderIds.length+ids.length<=MAX_ROUTE_STOPS,'A rota atingiu o limite de '+MAX_ROUTE_STOPS+' entregas.');
  const stops=ids.map(stopId=>state.orders?.[stopId]);
  for(const stop of stops)fail(stop&&stop.storeId===uid&&stop.serviceType==='delivery'&&!stop.roundtripSchema&&!stop.routeId&&!stop.kind&&['open','route_draft'].includes(stop.status)&&!stop.courierId&&!stop.assignedCourierId,'Selecione somente entregas simples e disponíveis desta loja.');
  fail(stops.every(stop=>stop.serviceDate===route.serviceDate),'As entregas devem ter a mesma data da rota.');
  fail(stops.every(stop=>stop.city===route.city),'As entregas devem ser da mesma cidade da rota.');
  fail(Object.keys(route.routeStoreIds||{}).length<5,'A rota atingiu o limite de 5 pontos de coleta.');
  const beforeRoute=structuredClone(route),base=route.routeOrderIds.length;
  route.routeStoreIds||={[route.storeId]:true};route.routeStoreIds[uid]=true;
  route.routePickups||=[{storeId:route.storeId,name:route.storeName,address:route.storeAddress}];
  route.routePickups.push({storeId:uid,name:stops[0].storeName,address:stops[0].storeAddress});route.pickupStoreIds=Object.keys(route.routeStoreIds);
  route.routeOrderIds.push(...ids);route.deliveryCount=route.routeOrderIds.length;route.routeValues.push(...stops.map(stop=>({neighborhood:stop.clientNeighborhood,fee:stop.fee})));route.fee=Math.round((route.fee+stops.reduce((sum,stop)=>sum+Math.round(stop.fee*100),0)/100)*100)/100;
  route.clientNeighborhood=route.routeValues.map(value=>value.neighborhood).join(' · ');route.fragile=route.fragile||stops.some(stop=>stop.fragile);route.importantNotes=route.importantNotes||stops.some(stop=>stop.importantNotes);
  ids.forEach((stopId,index)=>{const stop=stops[index],before=structuredClone(stop);Object.assign(stop,{routeId,routeSequence:base+index+1,routeOriginalStatus:stop.status,status:'grouped'});change(stopId,stop,before,'join-route');});
  route.id=routeId;change(routeId,route,beforeRoute,'join-route');return {ok:true,orderId:routeId,added:ids.length};
 }
 fail(o,'Pedido não encontrado.','not-found');const before=structuredClone(o);
 if(['requestReturn','releaseReturn','cancelReturn'].includes(action)){
  fail(o.roundtripSchema===1&&o.legNumber===2,'Este pedido não é uma devolução.');
  const first=state.orders?.[o.firstOrderId];fail(first?.status==='done','Conclua a recolha na loja antes de solicitar a devolução.');
  if(action==='requestReturn'){
   owner();fail(o.status==='awaiting_return','Devolução já solicitada ou encerrada.');
   fail(first.courierId,'Motoboy da recolha não encontrado.');
   Object.assign(o,{status:'return_priority',priorityCourierId:first.courierId,priorityUntil:now+RETURN_WINDOW,requestedAt:now,offerCreatedAt:now,offerGeneration:Number(o.offerGeneration||0)+1});
   put(state,'returnTimers/'+id,{until:o.priorityUntil});
  }else if(action==='releaseReturn'){
   fail((who?.role==='store'&&o.storeId===uid)||(who?.role==='courier'&&o.priorityCourierId===uid),'Somente a loja ou o motoboy prioritário pode liberar.','permission-denied');
   fail(o.status==='return_priority','A devolução já está aberta ou foi aceita.');
   Object.assign(o,{status:'open',priorityReleasedAt:now,priorityReleaseReason:'manual',offerGeneration:Number(o.offerGeneration||0)+1});put(state,'returnTimers/'+id,null);
  }else{owner();fail(['awaiting_return','return_priority','open'].includes(o.status),'Não é possível cancelar a devolução nesta etapa.');Object.assign(o,{status:'cancelled',cancelledAt:now,cancelledBy:uid});put(state,'returnTimers/'+id,null);}
  change(id,o,before);return {ok:true,orderId:id};
 }
 if(action==='publishDraft'||action==='discardDraft'){owner();fail(o.status==='route_draft'&&!o.routeId,'Esta entrega já foi publicada ou agrupada.');o.status=action==='publishDraft'?'open':'cancelled';if(action==='discardDraft'){o.cancelledAt=now;o.cancelledBy=uid;}o.offerGeneration=Number(o.offerGeneration||0)+1;change(id,o,before);return {ok:true,orderId:id};}
 fail(o.kind==='route','Rota não encontrada.');
 const stops=o.routeOrderIds.map(stopId=>state.orders[stopId]);
 if(action==='leaveRoute'){
  fail(who?.role==='store'&&o.status==='route_collecting'&&o.allowOtherStores===true&&uid!==o.storeId&&o.routeStoreIds?.[uid],'Somente uma loja participante pode retirar suas entregas antes da publicação.','permission-denied');
  const removed=o.routeOrderIds.filter(stopId=>state.orders?.[stopId]?.storeId===uid);fail(removed.length>0,'Esta loja não tem entregas nesta rota.');
  for(const stopId of removed){const stop=state.orders[stopId],old=structuredClone(stop);stop.status=stop.routeOriginalStatus==='open'?'open':'route_draft';for(const field of ['routeId','routeSequence','routeOriginalStatus'])delete stop[field];stop.offerGeneration=Number(stop.offerGeneration||0)+1;change(stopId,stop,old,'leave-route');}
  put(state,`storeOrders/${uid}/${id}`,null);o.routeOrderIds=o.routeOrderIds.filter(stopId=>!removed.includes(stopId));o.routeStoreIds[uid]=undefined;delete o.routeStoreIds[uid];o.routePickups=o.routePickups.filter(pickup=>pickup.storeId!==uid);o.pickupStoreIds=o.pickupStoreIds.filter(storeId=>storeId!==uid);o.deliveryCount=o.routeOrderIds.length;o.routeValues=o.routeOrderIds.map(stopId=>({neighborhood:state.orders[stopId].clientNeighborhood,fee:state.orders[stopId].fee}));o.fee=o.routeValues.reduce((sum,value)=>sum+Math.round(value.fee*100),0)/100;o.clientNeighborhood=o.routeValues.map(value=>value.neighborhood).join(' · ');o.fragile=o.routeOrderIds.some(stopId=>state.orders[stopId].fragile);o.importantNotes=o.routeOrderIds.some(stopId=>state.orders[stopId].importantNotes);o.routeOrderIds.forEach((stopId,index)=>{const stop=state.orders[stopId],old=structuredClone(stop);stop.routeSequence=index+1;change(stopId,stop,old,'resequence-route');});
  change(id,o,before,'leave-route');return {ok:true,orderId:id,removed:removed.length};
 }else if(action==='publishRoute'){
  owner();fail(o.status==='route_collecting'&&o.allowOtherStores===true,'Esta rota não está aguardando publicação.');
  fail(Object.keys(o.routeStoreIds||{}).length>=2,'Inclua uma segunda loja antes de publicar.');
  o.allowOtherStores=false;o.status='route_open';o.offerGeneration=Number(o.offerGeneration||0)+1;change(id,o,before);return {ok:true,orderId:id};
 }else if(action==='cancelRoute'){
  owner();const hasPickup=Object.keys(o.routePickupStoreIds||{}).length>0;fail(o.status==='route_collecting'||o.status==='route_open'||o.status==='run'&&!o.picked&&!hasPickup&&o.accepted&&now-o.accepted>=1500000,'Cancele antes da coleta ou após 25 minutos sem coleta.');
  for(const [index,stop]of stops.entries()){const old=structuredClone(stop);if(o.sharedRoute===true){stop.status=stop.routeOriginalStatus==='open'?'open':'route_draft';for(const field of ['routeId','routeSequence','routeOriginalStatus'])delete stop[field];stop.offerGeneration=Number(stop.offerGeneration||0)+1;}else Object.assign(stop,{status:'cancelled',cancelledAt:now,cancelledBy:uid,location:null});change(o.routeOrderIds[index],stop,old,'cancel-route-stop');}
  Object.assign(o,{status:'route_cancelled',cancelledAt:now,routeEndReason:'cancelled',location:null});
 }else if(action==='releaseRoute'){
  rider();fail(o.status==='run'&&!o.picked&&!Object.keys(o.routePickupStoreIds||{}).length,'Uma rota só pode ser devolvida antes da coleta em qualquer loja.');
  for(const [index,stop]of stops.entries()){const old=structuredClone(stop);stop.status='grouped';for(const f of ['courierId','courierName','accepted','picked','queuePosition','location','careAcknowledgedAt','careAcknowledgedBy'])delete stop[f];change(o.routeOrderIds[index],stop,old,'release-route-stop');}
  o.status='route_open';o.offerGeneration=Number(o.offerGeneration||0)+1;for(const f of ['courierId','courierName','accepted','picked','queuePosition','location','careAcknowledgedAt','careAcknowledgedBy'])delete o[f];
 }else if(action==='dissolveRoute'){
  owner();fail(o.status==='route_open','Desagrupe antes do aceite do motoboy.');
  for(const [index,stop]of stops.entries()){const old=structuredClone(stop);stop.status=stop.routeOriginalStatus==='open'?'open':'route_draft';delete stop.routeId;delete stop.routeSequence;delete stop.routeOriginalStatus;stop.offerGeneration=Number(stop.offerGeneration||0)+1;change(o.routeOrderIds[index],stop,old,'ungroup-route');}
  o.status='route_cancelled';o.cancelledAt=now;o.routeEndReason='dissolved';
 }else if(action==='routePickup'){
  rider();fail(o.status==='run'&&!o.picked,'Rota já coletada ou encerrada.');
  const pickupIds=o.pickupStoreIds||[o.storeId];const storeId=key(input.storeId|| (pickupIds.length===1?pickupIds[0]:''),'Loja de coleta');
  fail(pickupIds.includes(storeId)&&!o.routePickupStoreIds?.[storeId],'Esta coleta já foi confirmada ou não pertence à rota.');
  o.routePickupStoreIds||={};o.routePickupStoreIds[storeId]=now;
  for(const [index,stop]of stops.entries()){if(stop.storeId!==storeId)continue;const old=structuredClone(stop);stop.picked=now;change(o.routeOrderIds[index],stop,old,'route-pickup');}
  if(pickupIds.every(pickupId=>o.routePickupStoreIds[pickupId]))o.picked=now;
 }else if(action==='finishRouteStop'){
  rider();fail(o.status==='run'&&o.picked,'Confirme a coleta da rota na loja.');
  const stopId=key(input.stopId);const next=o.routeOrderIds.find(k=>state.orders[k].status!=='done');fail(stopId===next,'Conclua a próxima entrega da sequência.');
  const stop=state.orders[stopId],old=structuredClone(stop);fail(stop.routeId===id&&stop.courierId===uid&&inProgress(stop),'Entrega não pertence à sua rota.','permission-denied');
  complete(stop,who,uid,now);change(stopId,stop,old,'finish');o.completedStops=stops.filter(s=>s.status==='done').length;
  if(o.completedStops===o.deliveryCount)Object.assign(o,{status:'route_done',completed:now,...completionDurations(o,now),location:null});
 }else fail(false,'Ação de rota inválida.');
 change(id,o,before);return {ok:true,orderId:id};
}
function acceptRoute(state,id,o,who,uid,now,input,a){
 a.fail(input.logisticsVersion===1,'Atualize o aplicativo para aceitar uma rota múltipla.');
 a.fail(a.courierSlots(state,uid,id).length===0,'Conclua todas as corridas antes de aceitar uma rota múltipla.');
 for(const stopId of o.routeOrderIds){const stop=state.orders[stopId],before=structuredClone(stop);a.fail(stop.routeId===id&&stop.status==='grouped'&&!stop.courierId,'A rota foi alterada. Confira novamente.');Object.assign(stop,{status:'run',courierId:uid,courierName:who.name,accepted:now});if(stop.fragile||stop.importantNotes){stop.careAcknowledgedAt=now;stop.careAcknowledgedBy=uid;}a.commit(state,stopId,stop,before,now,uid,'route-accepted',input.requestId||'route');}
}
module.exports={handles:action=>actions.has(action),dispatch,linkRoundtrip,afterOrder,expireReturns,careFor,acceptRoute,storeRouteProjection,syncStoreRouteViews,RETURN_WINDOW,MAX_ROUTE_STOPS};
