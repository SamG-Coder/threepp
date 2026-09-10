import fs from 'node:fs';
const ops=[];
const add=(name,code,sync=false)=>ops.push({name,code,sync});
add('flush','glFlush();',true);
add('finish','glFinish();',true);
add('present','presentDrawingBuffer();',true);
const scalar={activeTexture:'u',attachShader:'uu',bindAttribLocation:'uus',bindBuffer:'uu',bindBufferBase:'uuu',bindFramebuffer:'uu',bindRenderbuffer:'uu',bindTexture:'uu',bindVertexArray:'u',blendColor:'ffff',blendEquation:'u',blendEquationSeparate:'uu',blendFunc:'uu',blendFuncSeparate:'uuuu',clear:'u',clearColor:'ffff',clearDepth:'d',clearStencil:'i',colorMask:'bbbb',compileShader:'u',cullFace:'u',depthFunc:'u',depthMask:'b',detachShader:'uu',disable:'u',disableVertexAttribArray:'u',drawArrays:'uii',drawArraysInstanced:'uiii',drawElements:'uiup',drawElementsInstanced:'uiupi',enable:'u',enableVertexAttribArray:'u',framebufferRenderbuffer:'uuuu',framebufferTexture2D:'uuuiu',framebufferTextureLayer:'uuuii',frontFace:'u',generateMipmap:'u',lineWidth:'f',linkProgram:'u',pixelStorei:'ui',polygonOffset:'ff',readBuffer:'u',renderbufferStorage:'uuii',renderbufferStorageMultisample:'uiuii',scissor:'iiii',stencilFunc:'uiu',stencilFuncSeparate:'uuiu',stencilMask:'u',stencilMaskSeparate:'uu',stencilOp:'uuu',stencilOpSeparate:'uuuu',texParameterf:'uuf',texParameteri:'uui',texStorage2D:'uiuii',texStorage3D:'uiuiii',uniformBlockBinding:'uuu',useProgram:'u',vertexAttribDivisor:'uu',vertexAttribIPointer:'ui uip'.replaceAll(' ',''),vertexAttribPointer:'uiubip',viewport:'iiii',blitFramebuffer:'iiiiiiiiuu'};
// framebufferTexture2D has five arguments: target, attachment, textarget, texture, level.
scalar.framebufferTexture2D='uuuui';
const cast={u:i=>`GLuint(a[${i}])`,i:i=>`GLint(a[${i}])`,f:i=>`GLfloat(a[${i}])`,d:i=>`GLdouble(a[${i}])`,b:i=>`GLboolean(a[${i}])`,p:i=>`reinterpret_cast<const void*>(uintptr_t(a[${i}]))`,s:()=>`reinterpret_cast<const char*>(data)`};
for(const [name,types]of Object.entries(scalar)){
 let code=`gl${name[0].toUpperCase()+name.slice(1)}(${[...types].map((t,i)=>cast[t](i)).join(',')});`;
 if(name==='bindFramebuffer')code='glBindFramebuffer(GLenum(a[0]),a[1]?GLuint(a[1]):drawingFramebuffer);';
 if(name==='renderbufferStorage')code+='initializeDepthRenderbuffer(GLenum(a[1]));';
 if(name==='renderbufferStorageMultisample')code+='initializeDepthRenderbuffer(GLenum(a[2]));';
 if(name==='readBuffer')code='GLint f=0;glGetIntegerv(GL_READ_FRAMEBUFFER_BINDING,&f);glReadBuffer(drawingFramebuffer&&GLuint(f)==drawingFramebuffer&&GLenum(a[0])==GL_BACK?GL_COLOR_ATTACHMENT0:GLenum(a[0]));';
 add(name,code);
}
for(const [name,kind]of [['Buffer','Buffers'],['Texture','Textures'],['Framebuffer','Framebuffers'],['Renderbuffer','Renderbuffers'],['VertexArray','VertexArrays']]){
 add('create'+name,`GLuint v;glGen${kind}(1,&v);r.kind=1;r.values[0]=v;`,true);
 add('delete'+name,`GLuint v=GLuint(a[0]);glDelete${kind}(1,&v);`);
}
for(const name of ['Program','Shader']){add('create'+name,`r.kind=1;r.values[0]=glCreate${name}(${name==='Shader'?'GLenum(a[0])':''});`,true);add('delete'+name,`glDelete${name}(GLuint(a[0]));`);}
add('shaderSource','const char* s=reinterpret_cast<const char*>(data);GLint len=GLint(bytes);glShaderSource(GLuint(a[0]),1,&s,&len);');
for(const kind of ['Program','Shader']){
 add('get'+kind+'Parameter',`GLint v=0;glGet${kind}iv(GLuint(a[0]),GLenum(a[1]),&v);r.kind=1;r.values[0]=v;`,true);
 add('get'+kind+'InfoLog',`GLsizei n=0;glGet${kind}InfoLog(GLuint(a[0]),sizeof(r.text)-1,&n,r.text);r.kind=3;`,true);
}
for(const kind of ['Uniform','Attrib']){
 add('get'+kind+'Location',`r.kind=1;r.values[0]=glGet${kind}Location(GLuint(a[0]),reinterpret_cast<const char*>(data));`,true);
 add('getActive'+kind,`GLsizei len=0;GLint size=0;GLenum type=0;glGetActive${kind}(GLuint(a[0]),GLuint(a[1]),sizeof(r.text)-1,&len,&size,&type,r.text);r.kind=4;r.values[0]=size;r.values[1]=type;`,true);
}
add('getError','r.kind=1;r.values[0]=glGetError();',true);
add('checkFramebufferStatus','r.kind=1;r.values[0]=glCheckFramebufferStatus(GLenum(a[0]));',true);
add('getParameter',`const GLenum p=GLenum(a[0]);switch(p){case GL_IMPLEMENTATION_COLOR_READ_FORMAT:case GL_IMPLEMENTATION_COLOR_READ_TYPE:case GL_MAX_COMBINED_TEXTURE_IMAGE_UNITS:case GL_MAX_CUBE_MAP_TEXTURE_SIZE:case GL_MAX_FRAGMENT_UNIFORM_VECTORS:case GL_MAX_SAMPLES:case GL_MAX_TEXTURE_IMAGE_UNITS:case GL_MAX_TEXTURE_SIZE:case GL_MAX_UNIFORM_BLOCK_SIZE:case GL_MAX_UNIFORM_BUFFER_BINDINGS:case GL_MAX_VARYING_VECTORS:case GL_MAX_VERTEX_ATTRIBS:case GL_MAX_VERTEX_TEXTURE_IMAGE_UNITS:case GL_MAX_VERTEX_UNIFORM_VECTORS:case GL_SAMPLES:case GL_SCISSOR_BOX:case GL_UNPACK_IMAGE_HEIGHT:case GL_UNPACK_ROW_LENGTH:case GL_UNPACK_SKIP_IMAGES:case GL_UNPACK_SKIP_PIXELS:case GL_UNPACK_SKIP_ROWS:case GL_VIEWPORT:case GL_VERSION:case GL_SHADING_LANGUAGE_VERSION:case GL_VENDOR:case GL_RENDERER:case GL_MAX_VIEWPORT_DIMS:case GL_ALIASED_LINE_WIDTH_RANGE:case GL_ALIASED_POINT_SIZE_RANGE:case GL_MAX_TEXTURE_MAX_ANISOTROPY_EXT:case GL_PACK_ALIGNMENT:case GL_UNPACK_ALIGNMENT:case GL_ARRAY_BUFFER_BINDING:case GL_ELEMENT_ARRAY_BUFFER_BINDING:case GL_CURRENT_PROGRAM:case GL_FRAMEBUFFER_BINDING:case GL_RENDERBUFFER_BINDING:case GL_ACTIVE_TEXTURE:case GL_TEXTURE_BINDING_2D:case GL_TEXTURE_BINDING_CUBE_MAP:break;default:throw std::runtime_error("Unsupported raw GL parameter query");}r.kind=1;
 if(p==GL_VERSION||p==GL_SHADING_LANGUAGE_VERSION||p==GL_VENDOR||p==GL_RENDERER){r.kind=3;const auto* s=glGetString(p);if(s)std::snprintf(r.text,sizeof(r.text),"%s",s);}
 else {int n=(p==GL_VIEWPORT||p==GL_SCISSOR_BOX)?4:((p==GL_MAX_VIEWPORT_DIMS||p==GL_ALIASED_LINE_WIDTH_RANGE||p==GL_ALIASED_POINT_SIZE_RANGE)?2:1);r.count=n;if(n>1)r.kind=5;
 if(p==GL_ALIASED_LINE_WIDTH_RANGE||p==GL_ALIASED_POINT_SIZE_RANGE||p==GL_MAX_TEXTURE_MAX_ANISOTROPY_EXT){GLfloat v[16]{};glGetFloatv(p,v);for(int i=0;i<n;i++)r.values[i]=v[i];}
 else{GLint v[16]{};glGetIntegerv(p,v);for(int i=0;i<n;i++)r.values[i]=v[i];}}`,true);
add('bufferData','if(a[1]<0||a[1]>2147483647||(bytes&&size_t(a[1])>bytes))throw std::runtime_error("Invalid bufferData size");glBufferData(GLenum(a[0]),GLsizeiptr(a[1]),bytes?data:nullptr,GLenum(a[2]));');
add('bufferSubData','glBufferSubData(GLenum(a[0]),GLintptr(a[1]),GLsizeiptr(bytes),data);');
add('drawBuffers','GLint f=0;glGetIntegerv(GL_DRAW_FRAMEBUFFER_BINDING,&f);if(drawingFramebuffer&&GLuint(f)==drawingFramebuffer&&bytes==4&&*reinterpret_cast<const GLenum*>(data)==GL_BACK){const GLenum attachment=GL_COLOR_ATTACHMENT0;glDrawBuffers(1,&attachment);}else glDrawBuffers(GLsizei(bytes/4),reinterpret_cast<const GLenum*>(data));');
add('invalidateFramebuffer','glInvalidateFramebuffer(GLenum(a[0]),GLsizei(bytes/4),reinterpret_cast<const GLenum*>(data));');
for(let n=1;n<=4;n++)for(const [suffix,type]of [['f','GLfloat'],['i','GLint'],['ui','GLuint']]){
 add(`uniform${n}${suffix}`,`glUniform${n}${suffix}(GLint(a[0]),${Array.from({length:n},(_,i)=>`${type}(a[${i+1}])`).join(',')});`);
 add(`uniform${n}${suffix}v`,`glUniform${n}${suffix}v(GLint(a[0]),GLsizei(bytes/${4*n}),reinterpret_cast<const ${type}*>(data));`);
}
for(let n=2;n<=4;n++)add(`uniformMatrix${n}fv`,`glUniformMatrix${n}fv(GLint(a[0]),GLsizei(bytes/${4*n*n}),GLboolean(a[1]),reinterpret_cast<const GLfloat*>(data));`);
for(let n=1;n<=4;n++)add(`vertexAttrib${n}fv`,`if(bytes<${4*n})throw std::runtime_error("Truncated vertex attribute");glVertexAttrib${n}fv(GLuint(a[0]),reinterpret_cast<const GLfloat*>(data));`);
add('texImage2D','validatePixels(a[3],a[4],1,a[6],a[7],bytes,true);glTexImage2D(GLenum(a[0]),GLint(a[1]),GLint(a[2]),GLsizei(a[3]),GLsizei(a[4]),GLint(a[5]),GLenum(a[6]),GLenum(a[7]),bytes?data:nullptr);');
add('texSubImage2D','validatePixels(a[4],a[5],1,a[6],a[7],bytes,false);glTexSubImage2D(GLenum(a[0]),GLint(a[1]),GLint(a[2]),GLint(a[3]),GLsizei(a[4]),GLsizei(a[5]),GLenum(a[6]),GLenum(a[7]),data);');
add('texImage3D','validatePixels(a[3],a[4],a[5],a[7],a[8],bytes,true);glTexImage3D(GLenum(a[0]),GLint(a[1]),GLint(a[2]),GLsizei(a[3]),GLsizei(a[4]),GLsizei(a[5]),GLint(a[6]),GLenum(a[7]),GLenum(a[8]),bytes?data:nullptr);');
add('texSubImage3D','validatePixels(a[5],a[6],a[7],a[8],a[9],bytes,false);glTexSubImage3D(GLenum(a[0]),GLint(a[1]),GLint(a[2]),GLint(a[3]),GLint(a[4]),GLsizei(a[5]),GLsizei(a[6]),GLsizei(a[7]),GLenum(a[8]),GLenum(a[9]),data);');
add('readPixels','validateRead(a[2],a[3],a[4],a[5],bytes);glReadPixels(GLint(a[0]),GLint(a[1]),GLsizei(a[2]),GLsizei(a[3]),GLenum(a[4]),GLenum(a[5]),output);',true);
add('getBufferSubData','glGetBufferSubData(GLenum(a[0]),GLintptr(a[1]),GLsizeiptr(bytes),output);',true);
add('getBridgeStats','r.kind=5;r.count=4;r.values[0]=tn::g.slots.size();r.values[1]=executedCommands;r.values[2]=executedBatches;r.values[3]=tn::g.drawScene.load();',true);
const root=new URL('../../',import.meta.url);
add('fenceSync','const auto sync=glFenceSync(GLenum(a[0]),GLbitfield(a[1]));r.kind=1;if(sync){const auto id=nextRawSync++;rawSyncs.emplace(id,sync);r.values[0]=id;}',true);
add('clientWaitSync','r.kind=1;r.values[0]=glClientWaitSync(rawSync(a[0]),GLbitfield(a[1]),GLuint64(a[2]));',true);
add('deleteSync','glDeleteSync(rawSync(a[0]));rawSyncs.erase(uint32_t(a[0]));',true);
add('configureDrawingBuffer','configureDrawingBuffer(GLint(a[0]),GLint(a[1]));',true);
fs.writeFileSync(new URL('native/raw_gl_ops.inc',root),ops.map((o,i)=>`case ${i}: { ${o.code} break; } // ${o.name}`).join('\n')+'\n');
fs.writeFileSync(new URL('native/raw_gl_sync.inc',root),'switch(op) {\n'+ops.filter(o=>o.sync).map(o=>`case ${ops.indexOf(o)}:`).join('\n')+' return true;default:return false;}\n');
const glad=fs.readFileSync(new URL('src/external/glad/glad/glad.h',root),'utf8');const constants={};for(const m of glad.matchAll(/^#define GL_(\w+) (0x[\da-fA-F]+|\d+)$/gm))constants[m[1]]=Number(m[2]);
Object.assign(constants,{UNPACK_FLIP_Y_WEBGL:37440,UNPACK_PREMULTIPLY_ALPHA_WEBGL:37441,CONTEXT_LOST_WEBGL:37442,UNPACK_COLORSPACE_CONVERSION_WEBGL:37443,BROWSER_DEFAULT_WEBGL:37444});
fs.writeFileSync(new URL('ThreeBrowserRuntime/runtime/raw-gl-generated.mjs',root),'// Generated by scripts/generate-raw-gl.mjs.\nexport const OPS='+JSON.stringify(Object.fromEntries(ops.map((o,i)=>[o.name,i])))+';\nexport const SYNC='+JSON.stringify(ops.filter(o=>o.sync).map(o=>o.name))+';\nexport const CONSTANTS='+JSON.stringify(constants)+';\n');
console.log('Generated',ops.length,'graphics commands');
