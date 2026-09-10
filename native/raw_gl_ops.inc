case 0: { glFlush(); break; } // flush
case 1: { glFinish(); break; } // finish
case 2: { glfwSwapBuffers(static_cast<GLFWwindow*>(tn::g.canvas->windowPtr()));tn::g.statsPresents.fetch_add(1); break; } // present
case 3: { glActiveTexture(GLuint(a[0])); break; } // activeTexture
case 4: { glAttachShader(GLuint(a[0]),GLuint(a[1])); break; } // attachShader
case 5: { glBindAttribLocation(GLuint(a[0]),GLuint(a[1]),reinterpret_cast<const char*>(data)); break; } // bindAttribLocation
case 6: { glBindBuffer(GLuint(a[0]),GLuint(a[1])); break; } // bindBuffer
case 7: { glBindBufferBase(GLuint(a[0]),GLuint(a[1]),GLuint(a[2])); break; } // bindBufferBase
case 8: { glBindFramebuffer(GLuint(a[0]),GLuint(a[1])); break; } // bindFramebuffer
case 9: { glBindRenderbuffer(GLuint(a[0]),GLuint(a[1])); break; } // bindRenderbuffer
case 10: { glBindTexture(GLuint(a[0]),GLuint(a[1])); break; } // bindTexture
case 11: { glBindVertexArray(GLuint(a[0])); break; } // bindVertexArray
case 12: { glBlendColor(GLfloat(a[0]),GLfloat(a[1]),GLfloat(a[2]),GLfloat(a[3])); break; } // blendColor
case 13: { glBlendEquation(GLuint(a[0])); break; } // blendEquation
case 14: { glBlendEquationSeparate(GLuint(a[0]),GLuint(a[1])); break; } // blendEquationSeparate
case 15: { glBlendFunc(GLuint(a[0]),GLuint(a[1])); break; } // blendFunc
case 16: { glBlendFuncSeparate(GLuint(a[0]),GLuint(a[1]),GLuint(a[2]),GLuint(a[3])); break; } // blendFuncSeparate
case 17: { glClear(GLuint(a[0])); break; } // clear
case 18: { glClearColor(GLfloat(a[0]),GLfloat(a[1]),GLfloat(a[2]),GLfloat(a[3])); break; } // clearColor
case 19: { glClearDepth(GLdouble(a[0])); break; } // clearDepth
case 20: { glClearStencil(GLint(a[0])); break; } // clearStencil
case 21: { glColorMask(GLboolean(a[0]),GLboolean(a[1]),GLboolean(a[2]),GLboolean(a[3])); break; } // colorMask
case 22: { glCompileShader(GLuint(a[0])); break; } // compileShader
case 23: { glCullFace(GLuint(a[0])); break; } // cullFace
case 24: { glDepthFunc(GLuint(a[0])); break; } // depthFunc
case 25: { glDepthMask(GLboolean(a[0])); break; } // depthMask
case 26: { glDetachShader(GLuint(a[0]),GLuint(a[1])); break; } // detachShader
case 27: { glDisable(GLuint(a[0])); break; } // disable
case 28: { glDisableVertexAttribArray(GLuint(a[0])); break; } // disableVertexAttribArray
case 29: { glDrawArrays(GLuint(a[0]),GLint(a[1]),GLint(a[2])); break; } // drawArrays
case 30: { glDrawArraysInstanced(GLuint(a[0]),GLint(a[1]),GLint(a[2]),GLint(a[3])); break; } // drawArraysInstanced
case 31: { glDrawElements(GLuint(a[0]),GLint(a[1]),GLuint(a[2]),reinterpret_cast<const void*>(uintptr_t(a[3]))); break; } // drawElements
case 32: { glDrawElementsInstanced(GLuint(a[0]),GLint(a[1]),GLuint(a[2]),reinterpret_cast<const void*>(uintptr_t(a[3])),GLint(a[4])); break; } // drawElementsInstanced
case 33: { glEnable(GLuint(a[0])); break; } // enable
case 34: { glEnableVertexAttribArray(GLuint(a[0])); break; } // enableVertexAttribArray
case 35: { glFramebufferRenderbuffer(GLuint(a[0]),GLuint(a[1]),GLuint(a[2]),GLuint(a[3])); break; } // framebufferRenderbuffer
case 36: { glFramebufferTexture2D(GLuint(a[0]),GLuint(a[1]),GLuint(a[2]),GLuint(a[3]),GLint(a[4])); break; } // framebufferTexture2D
case 37: { glFramebufferTextureLayer(GLuint(a[0]),GLuint(a[1]),GLuint(a[2]),GLint(a[3]),GLint(a[4])); break; } // framebufferTextureLayer
case 38: { glFrontFace(GLuint(a[0])); break; } // frontFace
case 39: { glGenerateMipmap(GLuint(a[0])); break; } // generateMipmap
case 40: { glLineWidth(GLfloat(a[0])); break; } // lineWidth
case 41: { glLinkProgram(GLuint(a[0])); break; } // linkProgram
case 42: { glPixelStorei(GLuint(a[0]),GLint(a[1])); break; } // pixelStorei
case 43: { glPolygonOffset(GLfloat(a[0]),GLfloat(a[1])); break; } // polygonOffset
case 44: { glReadBuffer(GLuint(a[0])); break; } // readBuffer
case 45: { glRenderbufferStorage(GLuint(a[0]),GLuint(a[1]),GLint(a[2]),GLint(a[3])); break; } // renderbufferStorage
case 46: { glRenderbufferStorageMultisample(GLuint(a[0]),GLint(a[1]),GLuint(a[2]),GLint(a[3]),GLint(a[4])); break; } // renderbufferStorageMultisample
case 47: { glScissor(GLint(a[0]),GLint(a[1]),GLint(a[2]),GLint(a[3])); break; } // scissor
case 48: { glStencilFunc(GLuint(a[0]),GLint(a[1]),GLuint(a[2])); break; } // stencilFunc
case 49: { glStencilFuncSeparate(GLuint(a[0]),GLuint(a[1]),GLint(a[2]),GLuint(a[3])); break; } // stencilFuncSeparate
case 50: { glStencilMask(GLuint(a[0])); break; } // stencilMask
case 51: { glStencilMaskSeparate(GLuint(a[0]),GLuint(a[1])); break; } // stencilMaskSeparate
case 52: { glStencilOp(GLuint(a[0]),GLuint(a[1]),GLuint(a[2])); break; } // stencilOp
case 53: { glStencilOpSeparate(GLuint(a[0]),GLuint(a[1]),GLuint(a[2]),GLuint(a[3])); break; } // stencilOpSeparate
case 54: { glTexParameterf(GLuint(a[0]),GLuint(a[1]),GLfloat(a[2])); break; } // texParameterf
case 55: { glTexParameteri(GLuint(a[0]),GLuint(a[1]),GLint(a[2])); break; } // texParameteri
case 56: { glTexStorage2D(GLuint(a[0]),GLint(a[1]),GLuint(a[2]),GLint(a[3]),GLint(a[4])); break; } // texStorage2D
case 57: { glTexStorage3D(GLuint(a[0]),GLint(a[1]),GLuint(a[2]),GLint(a[3]),GLint(a[4]),GLint(a[5])); break; } // texStorage3D
case 58: { glUniformBlockBinding(GLuint(a[0]),GLuint(a[1]),GLuint(a[2])); break; } // uniformBlockBinding
case 59: { glUseProgram(GLuint(a[0])); break; } // useProgram
case 60: { glVertexAttribDivisor(GLuint(a[0]),GLuint(a[1])); break; } // vertexAttribDivisor
case 61: { glVertexAttribIPointer(GLuint(a[0]),GLint(a[1]),GLuint(a[2]),GLint(a[3]),reinterpret_cast<const void*>(uintptr_t(a[4]))); break; } // vertexAttribIPointer
case 62: { glVertexAttribPointer(GLuint(a[0]),GLint(a[1]),GLuint(a[2]),GLboolean(a[3]),GLint(a[4]),reinterpret_cast<const void*>(uintptr_t(a[5]))); break; } // vertexAttribPointer
case 63: { glViewport(GLint(a[0]),GLint(a[1]),GLint(a[2]),GLint(a[3])); break; } // viewport
case 64: { glBlitFramebuffer(GLint(a[0]),GLint(a[1]),GLint(a[2]),GLint(a[3]),GLint(a[4]),GLint(a[5]),GLint(a[6]),GLint(a[7]),GLuint(a[8]),GLuint(a[9])); break; } // blitFramebuffer
case 65: { GLuint v;glGenBuffers(1,&v);r.kind=1;r.values[0]=v; break; } // createBuffer
case 66: { GLuint v=GLuint(a[0]);glDeleteBuffers(1,&v); break; } // deleteBuffer
case 67: { GLuint v;glGenTextures(1,&v);r.kind=1;r.values[0]=v; break; } // createTexture
case 68: { GLuint v=GLuint(a[0]);glDeleteTextures(1,&v); break; } // deleteTexture
case 69: { GLuint v;glGenFramebuffers(1,&v);r.kind=1;r.values[0]=v; break; } // createFramebuffer
case 70: { GLuint v=GLuint(a[0]);glDeleteFramebuffers(1,&v); break; } // deleteFramebuffer
case 71: { GLuint v;glGenRenderbuffers(1,&v);r.kind=1;r.values[0]=v; break; } // createRenderbuffer
case 72: { GLuint v=GLuint(a[0]);glDeleteRenderbuffers(1,&v); break; } // deleteRenderbuffer
case 73: { GLuint v;glGenVertexArrays(1,&v);r.kind=1;r.values[0]=v; break; } // createVertexArray
case 74: { GLuint v=GLuint(a[0]);glDeleteVertexArrays(1,&v); break; } // deleteVertexArray
case 75: { r.kind=1;r.values[0]=glCreateProgram(); break; } // createProgram
case 76: { glDeleteProgram(GLuint(a[0])); break; } // deleteProgram
case 77: { r.kind=1;r.values[0]=glCreateShader(GLenum(a[0])); break; } // createShader
case 78: { glDeleteShader(GLuint(a[0])); break; } // deleteShader
case 79: { const char* s=reinterpret_cast<const char*>(data);GLint len=GLint(bytes);glShaderSource(GLuint(a[0]),1,&s,&len); break; } // shaderSource
case 80: { GLint v=0;glGetProgramiv(GLuint(a[0]),GLenum(a[1]),&v);r.kind=1;r.values[0]=v; break; } // getProgramParameter
case 81: { GLsizei n=0;glGetProgramInfoLog(GLuint(a[0]),sizeof(r.text)-1,&n,r.text);r.kind=3; break; } // getProgramInfoLog
case 82: { GLint v=0;glGetShaderiv(GLuint(a[0]),GLenum(a[1]),&v);r.kind=1;r.values[0]=v; break; } // getShaderParameter
case 83: { GLsizei n=0;glGetShaderInfoLog(GLuint(a[0]),sizeof(r.text)-1,&n,r.text);r.kind=3; break; } // getShaderInfoLog
case 84: { r.kind=1;r.values[0]=glGetUniformLocation(GLuint(a[0]),reinterpret_cast<const char*>(data)); break; } // getUniformLocation
case 85: { GLsizei len=0;GLint size=0;GLenum type=0;glGetActiveUniform(GLuint(a[0]),GLuint(a[1]),sizeof(r.text)-1,&len,&size,&type,r.text);r.kind=4;r.values[0]=size;r.values[1]=type; break; } // getActiveUniform
case 86: { r.kind=1;r.values[0]=glGetAttribLocation(GLuint(a[0]),reinterpret_cast<const char*>(data)); break; } // getAttribLocation
case 87: { GLsizei len=0;GLint size=0;GLenum type=0;glGetActiveAttrib(GLuint(a[0]),GLuint(a[1]),sizeof(r.text)-1,&len,&size,&type,r.text);r.kind=4;r.values[0]=size;r.values[1]=type; break; } // getActiveAttrib
case 88: { r.kind=1;r.values[0]=glGetError(); break; } // getError
case 89: { r.kind=1;r.values[0]=glCheckFramebufferStatus(GLenum(a[0])); break; } // checkFramebufferStatus
case 90: { const GLenum p=GLenum(a[0]);switch(p){case GL_IMPLEMENTATION_COLOR_READ_FORMAT:case GL_IMPLEMENTATION_COLOR_READ_TYPE:case GL_MAX_COMBINED_TEXTURE_IMAGE_UNITS:case GL_MAX_CUBE_MAP_TEXTURE_SIZE:case GL_MAX_FRAGMENT_UNIFORM_VECTORS:case GL_MAX_SAMPLES:case GL_MAX_TEXTURE_IMAGE_UNITS:case GL_MAX_TEXTURE_SIZE:case GL_MAX_UNIFORM_BLOCK_SIZE:case GL_MAX_UNIFORM_BUFFER_BINDINGS:case GL_MAX_VARYING_VECTORS:case GL_MAX_VERTEX_ATTRIBS:case GL_MAX_VERTEX_TEXTURE_IMAGE_UNITS:case GL_MAX_VERTEX_UNIFORM_VECTORS:case GL_SAMPLES:case GL_SCISSOR_BOX:case GL_UNPACK_IMAGE_HEIGHT:case GL_UNPACK_ROW_LENGTH:case GL_UNPACK_SKIP_IMAGES:case GL_UNPACK_SKIP_PIXELS:case GL_UNPACK_SKIP_ROWS:case GL_VIEWPORT:case GL_VERSION:case GL_SHADING_LANGUAGE_VERSION:case GL_VENDOR:case GL_RENDERER:case GL_MAX_VIEWPORT_DIMS:case GL_ALIASED_LINE_WIDTH_RANGE:case GL_ALIASED_POINT_SIZE_RANGE:case GL_MAX_TEXTURE_MAX_ANISOTROPY_EXT:case GL_PACK_ALIGNMENT:case GL_UNPACK_ALIGNMENT:case GL_ARRAY_BUFFER_BINDING:case GL_ELEMENT_ARRAY_BUFFER_BINDING:case GL_CURRENT_PROGRAM:case GL_FRAMEBUFFER_BINDING:case GL_RENDERBUFFER_BINDING:case GL_ACTIVE_TEXTURE:case GL_TEXTURE_BINDING_2D:case GL_TEXTURE_BINDING_CUBE_MAP:break;default:throw std::runtime_error("Unsupported raw GL parameter query");}r.kind=1;
 if(p==GL_VERSION||p==GL_SHADING_LANGUAGE_VERSION||p==GL_VENDOR||p==GL_RENDERER){r.kind=3;const auto* s=glGetString(p);if(s)std::snprintf(r.text,sizeof(r.text),"%s",s);}
 else {int n=(p==GL_VIEWPORT||p==GL_SCISSOR_BOX)?4:((p==GL_MAX_VIEWPORT_DIMS||p==GL_ALIASED_LINE_WIDTH_RANGE||p==GL_ALIASED_POINT_SIZE_RANGE)?2:1);r.count=n;if(n>1)r.kind=5;
 if(p==GL_ALIASED_LINE_WIDTH_RANGE||p==GL_ALIASED_POINT_SIZE_RANGE||p==GL_MAX_TEXTURE_MAX_ANISOTROPY_EXT){GLfloat v[16]{};glGetFloatv(p,v);for(int i=0;i<n;i++)r.values[i]=v[i];}
 else{GLint v[16]{};glGetIntegerv(p,v);for(int i=0;i<n;i++)r.values[i]=v[i];}} break; } // getParameter
case 91: { if(a[1]<0||a[1]>2147483647||(bytes&&size_t(a[1])>bytes))throw std::runtime_error("Invalid bufferData size");glBufferData(GLenum(a[0]),GLsizeiptr(a[1]),bytes?data:nullptr,GLenum(a[2])); break; } // bufferData
case 92: { glBufferSubData(GLenum(a[0]),GLintptr(a[1]),GLsizeiptr(bytes),data); break; } // bufferSubData
case 93: { glDrawBuffers(GLsizei(bytes/4),reinterpret_cast<const GLenum*>(data)); break; } // drawBuffers
case 94: { glInvalidateFramebuffer(GLenum(a[0]),GLsizei(bytes/4),reinterpret_cast<const GLenum*>(data)); break; } // invalidateFramebuffer
case 95: { glUniform1f(GLint(a[0]),GLfloat(a[1])); break; } // uniform1f
case 96: { glUniform1fv(GLint(a[0]),GLsizei(bytes/4),reinterpret_cast<const GLfloat*>(data)); break; } // uniform1fv
case 97: { glUniform1i(GLint(a[0]),GLint(a[1])); break; } // uniform1i
case 98: { glUniform1iv(GLint(a[0]),GLsizei(bytes/4),reinterpret_cast<const GLint*>(data)); break; } // uniform1iv
case 99: { glUniform1ui(GLint(a[0]),GLuint(a[1])); break; } // uniform1ui
case 100: { glUniform1uiv(GLint(a[0]),GLsizei(bytes/4),reinterpret_cast<const GLuint*>(data)); break; } // uniform1uiv
case 101: { glUniform2f(GLint(a[0]),GLfloat(a[1]),GLfloat(a[2])); break; } // uniform2f
case 102: { glUniform2fv(GLint(a[0]),GLsizei(bytes/8),reinterpret_cast<const GLfloat*>(data)); break; } // uniform2fv
case 103: { glUniform2i(GLint(a[0]),GLint(a[1]),GLint(a[2])); break; } // uniform2i
case 104: { glUniform2iv(GLint(a[0]),GLsizei(bytes/8),reinterpret_cast<const GLint*>(data)); break; } // uniform2iv
case 105: { glUniform2ui(GLint(a[0]),GLuint(a[1]),GLuint(a[2])); break; } // uniform2ui
case 106: { glUniform2uiv(GLint(a[0]),GLsizei(bytes/8),reinterpret_cast<const GLuint*>(data)); break; } // uniform2uiv
case 107: { glUniform3f(GLint(a[0]),GLfloat(a[1]),GLfloat(a[2]),GLfloat(a[3])); break; } // uniform3f
case 108: { glUniform3fv(GLint(a[0]),GLsizei(bytes/12),reinterpret_cast<const GLfloat*>(data)); break; } // uniform3fv
case 109: { glUniform3i(GLint(a[0]),GLint(a[1]),GLint(a[2]),GLint(a[3])); break; } // uniform3i
case 110: { glUniform3iv(GLint(a[0]),GLsizei(bytes/12),reinterpret_cast<const GLint*>(data)); break; } // uniform3iv
case 111: { glUniform3ui(GLint(a[0]),GLuint(a[1]),GLuint(a[2]),GLuint(a[3])); break; } // uniform3ui
case 112: { glUniform3uiv(GLint(a[0]),GLsizei(bytes/12),reinterpret_cast<const GLuint*>(data)); break; } // uniform3uiv
case 113: { glUniform4f(GLint(a[0]),GLfloat(a[1]),GLfloat(a[2]),GLfloat(a[3]),GLfloat(a[4])); break; } // uniform4f
case 114: { glUniform4fv(GLint(a[0]),GLsizei(bytes/16),reinterpret_cast<const GLfloat*>(data)); break; } // uniform4fv
case 115: { glUniform4i(GLint(a[0]),GLint(a[1]),GLint(a[2]),GLint(a[3]),GLint(a[4])); break; } // uniform4i
case 116: { glUniform4iv(GLint(a[0]),GLsizei(bytes/16),reinterpret_cast<const GLint*>(data)); break; } // uniform4iv
case 117: { glUniform4ui(GLint(a[0]),GLuint(a[1]),GLuint(a[2]),GLuint(a[3]),GLuint(a[4])); break; } // uniform4ui
case 118: { glUniform4uiv(GLint(a[0]),GLsizei(bytes/16),reinterpret_cast<const GLuint*>(data)); break; } // uniform4uiv
case 119: { glUniformMatrix2fv(GLint(a[0]),GLsizei(bytes/16),GLboolean(a[1]),reinterpret_cast<const GLfloat*>(data)); break; } // uniformMatrix2fv
case 120: { glUniformMatrix3fv(GLint(a[0]),GLsizei(bytes/36),GLboolean(a[1]),reinterpret_cast<const GLfloat*>(data)); break; } // uniformMatrix3fv
case 121: { glUniformMatrix4fv(GLint(a[0]),GLsizei(bytes/64),GLboolean(a[1]),reinterpret_cast<const GLfloat*>(data)); break; } // uniformMatrix4fv
case 122: { if(bytes<4)throw std::runtime_error("Truncated vertex attribute");glVertexAttrib1fv(GLuint(a[0]),reinterpret_cast<const GLfloat*>(data)); break; } // vertexAttrib1fv
case 123: { if(bytes<8)throw std::runtime_error("Truncated vertex attribute");glVertexAttrib2fv(GLuint(a[0]),reinterpret_cast<const GLfloat*>(data)); break; } // vertexAttrib2fv
case 124: { if(bytes<12)throw std::runtime_error("Truncated vertex attribute");glVertexAttrib3fv(GLuint(a[0]),reinterpret_cast<const GLfloat*>(data)); break; } // vertexAttrib3fv
case 125: { if(bytes<16)throw std::runtime_error("Truncated vertex attribute");glVertexAttrib4fv(GLuint(a[0]),reinterpret_cast<const GLfloat*>(data)); break; } // vertexAttrib4fv
case 126: { validatePixels(a[3],a[4],1,a[6],a[7],bytes,true);glTexImage2D(GLenum(a[0]),GLint(a[1]),GLint(a[2]),GLsizei(a[3]),GLsizei(a[4]),GLint(a[5]),GLenum(a[6]),GLenum(a[7]),bytes?data:nullptr); break; } // texImage2D
case 127: { validatePixels(a[4],a[5],1,a[6],a[7],bytes,false);glTexSubImage2D(GLenum(a[0]),GLint(a[1]),GLint(a[2]),GLint(a[3]),GLsizei(a[4]),GLsizei(a[5]),GLenum(a[6]),GLenum(a[7]),data); break; } // texSubImage2D
case 128: { validatePixels(a[3],a[4],a[5],a[7],a[8],bytes,true);glTexImage3D(GLenum(a[0]),GLint(a[1]),GLint(a[2]),GLsizei(a[3]),GLsizei(a[4]),GLsizei(a[5]),GLint(a[6]),GLenum(a[7]),GLenum(a[8]),bytes?data:nullptr); break; } // texImage3D
case 129: { validatePixels(a[5],a[6],a[7],a[8],a[9],bytes,false);glTexSubImage3D(GLenum(a[0]),GLint(a[1]),GLint(a[2]),GLint(a[3]),GLint(a[4]),GLsizei(a[5]),GLsizei(a[6]),GLsizei(a[7]),GLenum(a[8]),GLenum(a[9]),data); break; } // texSubImage3D
case 130: { validateRead(a[2],a[3],a[4],a[5],bytes);glReadPixels(GLint(a[0]),GLint(a[1]),GLsizei(a[2]),GLsizei(a[3]),GLenum(a[4]),GLenum(a[5]),output); break; } // readPixels
case 131: { glGetBufferSubData(GLenum(a[0]),GLintptr(a[1]),GLsizeiptr(bytes),output); break; } // getBufferSubData
case 132: { r.kind=5;r.count=4;r.values[0]=tn::g.slots.size();r.values[1]=executedCommands;r.values[2]=executedBatches;r.values[3]=tn::g.drawScene.load(); break; } // getBridgeStats
