import {locationFresh} from './ui-utils.mjs';

export function buildContext({now=new Date().toISOString(),timezone,locationMode='fixture',browserLocation,locationError='',weatherAvailability,geocoding=true,selectedObjects={}}={}) {
  const context={now,timezone};
  if(locationMode==='fixture')context.location={latitude:31.2304,longitude:121.4737,label:'上海固定坐标夹具',source:'fixture',precision:'coordinate'};
  if(locationMode==='coarse')context.location={latitude:31.2304,longitude:121.4737,label:'上海城市代表点夹具',source:'fixture',precision:'city',accuracyMeters:20000};
  if(locationMode==='none')context.location=null;
  if(locationMode==='browser') {
    const accuracy=browserLocation?.accuracyMeters ?? browserLocation?.accuracy;
    context.location=locationFresh(browserLocation,Date.parse(now))?{...browserLocation,...(Number.isFinite(accuracy)?{accuracyMeters:accuracy}:{}),precision:browserLocation.precision || (accuracy>1000?'coarse':'coordinate')}:null;
    if(!context.location)context.locationError=browserLocation?'浏览器位置已超过 5 分钟，请重新获取。':locationError || '尚未授权获取浏览器位置';
  }
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
