export function buildContext({now=new Date().toISOString(),timezone,locationMode='fixture',weatherAvailability,geocoding=true,selectedObjects={}}={}) {
  // PC experiments simulate the phone, never read the computer's physical position.
  const context={now,timezone,location:null};
  if(locationMode==='fixture')context.location={latitude:31.2304,longitude:121.4737,label:'模拟手机当前位置（上海固定坐标）',source:'fixture',precision:'coordinate'};
  else if(locationMode==='coarse')context.location={latitude:31.2304,longitude:121.4737,label:'模拟手机当前位置（上海粗位置）',source:'fixture',precision:'city',accuracyMeters:20000};
  else if(locationMode!=='none')context.locationError='当前 PC 实验台仅支持模拟手机位置 fixture/coarse/none；该位置模式不可用，不读取电脑位置，也不自动替换为固定坐标。';
  if(weatherAvailability)context.weatherAvailability={current:true,hourly:true,daily:true,minute:true,alerts:true,indices:true,tides:true,city:true,...weatherAvailability};
  if(!geocoding)context.geocodes={};
  const objects={};
  for(const field of ['event_id','contact_id','file_id','material_id']) {
    const value=typeof selectedObjects[field]==='string'?selectedObjects[field].trim():'';
    if(value)objects[field]={value,trusted:true,source:'user_selection'};
  }
  if(Object.keys(objects).length)context.objects=objects;
  return context;
}
