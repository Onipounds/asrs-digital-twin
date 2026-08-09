const fs=require('fs'), path=require('path'), dir=__dirname;
const durl=(p)=>'data:text/javascript;base64,'+Buffer.from(fs.readFileSync(path.join(dir,p))).toString('base64');
const importmap=`<script type="importmap">
{ "imports": {
  "three": "${durl('vendor/three.module.js')}",
  "three/addons/controls/OrbitControls.js": "${durl('vendor/jsm/controls/OrbitControls.js')}",
  "three/addons/environments/RoomEnvironment.js": "${durl('vendor/jsm/environments/RoomEnvironment.js')}"
}}
</script>`;
let html=fs.readFileSync(path.join(dir,'asrs_twin_3d.html'),'utf8');
html=html.replace(/<script type="importmap">[\s\S]*?<\/script>/, importmap);
fs.writeFileSync(path.join(dir,'asrs_twin_3d_standalone.html'),html);
console.log('wrote standalone', (fs.statSync(path.join(dir,'asrs_twin_3d_standalone.html')).size/1024/1024).toFixed(2),'MB');
