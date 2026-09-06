const T = THREE;
const renderer = new T.WebGLRenderer();
renderer.setSize(256,256);
renderer.toneMapping = T.NoToneMapping;
const target = new T.WebGLRenderTarget(256,256,{type:T.HalfFloatType});
const camera = new T.OrthographicCamera(-1,1,1,-1,0,1);
const vertexShader = 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
const first = new T.Mesh(new T.PlaneGeometry(2,2),new T.ShaderMaterial({depthTest:false,depthWrite:false,vertexShader,uniforms:{weights:{value:[0.125,0.125]}},fragmentShader:'uniform float weights[2];void main(){gl_FragColor=vec4(weights[0]+weights[1],0.,0.,1.);}'}));
const second = new T.Mesh(new T.PlaneGeometry(2,2),new T.ShaderMaterial({depthTest:false,depthWrite:false,transparent:true,blending:T.AdditiveBlending,vertexShader,uniforms:{tints:{value:[new T.Vector3(0,.25,0),new T.Vector3(0,.25,0)]}},fragmentShader:'uniform vec3 tints[2];void main(){gl_FragColor=vec4(tints[0]+tints[1],1.);}'}));
const copy = new T.Mesh(new T.PlaneGeometry(2,2),new T.ShaderMaterial({depthTest:false,depthWrite:false,vertexShader,uniforms:{image:{value:target.texture}},fragmentShader:'uniform sampler2D image;varying vec2 vUv;void main(){gl_FragColor=texture2D(image,vUv);}'}));
function frame(){
 renderer.setRenderTarget(target);
 renderer.autoClear=true;
 renderer.clear();
 renderer.render(first,camera);
 renderer.autoClear=false;
 renderer.render(second,camera);
 renderer.setRenderTarget(null);
 renderer.render(copy,camera);
 requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
