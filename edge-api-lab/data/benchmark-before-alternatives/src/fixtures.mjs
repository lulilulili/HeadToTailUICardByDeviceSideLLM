/** Reproducible city-centre fixtures; these never claim to be actual geocoding or device positions. */
const city=(label,latitude,longitude)=>({label,latitude,longitude,precision:'city',source:'fixture'});
export const geocodes={
 上海:city('上海市（地理编码夹具）',31.2304,121.4737),北京:city('北京市（地理编码夹具）',39.9042,116.4074),
 杭州:city('杭州市（地理编码夹具）',30.2741,120.1551),深圳:city('深圳市（地理编码夹具）',22.5431,114.0579),
 广州:city('广州市（地理编码夹具）',23.1291,113.2644),成都:city('成都市（地理编码夹具）',30.5728,104.0668),
 南京:city('南京市（地理编码夹具）',32.0603,118.7969),武汉:city('武汉市（地理编码夹具）',30.5928,114.3055)
};
export const experimentDefaults={geocodes,weatherAvailability:{current:true,hourly:true,daily:true,minute:true,alerts:true,indices:true,tides:true,city:true},weatherAvailabilitySource:'fixture',weatherRegion:'CN'};
