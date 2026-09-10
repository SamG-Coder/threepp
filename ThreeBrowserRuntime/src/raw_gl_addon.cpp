#include "raw_gl_addon.h"
#include "raw_gl.h"
#include <array>
#include <cmath>
#include <string>
#include <vector>

namespace {
napi_value call(napi_env env,napi_callback_info info) {
    napi_value argv[3]{};size_t argc=3;napi_get_cb_info(env,info,&argc,argv,nullptr,nullptr);
    int32_t op=0;bool array=false;uint32_t length=0;
    if(argc<2||napi_get_value_int32(env,argv[0],&op)!=napi_ok||napi_is_array(env,argv[1],&array)!=napi_ok||!array||napi_get_array_length(env,argv[1],&length)!=napi_ok||length>10) {
        napi_throw_type_error(env,nullptr,"rawGlCall requires an opcode and at most ten numeric arguments");return nullptr;
    }
    std::array<double,10> args{};
    for(uint32_t i=0;i<length;i++) {napi_value value;napi_get_element(env,argv[1],i,&value);if(napi_get_value_double(env,value,&args[i])!=napi_ok||!std::isfinite(args[i])){napi_throw_type_error(env,nullptr,"Raw GL arguments must be finite numbers");return nullptr;}}
    void* data=nullptr;size_t bytes=0;std::string text;
    if(argc>2) {
        napi_valuetype type;napi_typeof(env,argv[2],&type);
        if(type==napi_string) {size_t size=0;napi_get_value_string_utf8(env,argv[2],nullptr,0,&size);text.resize(size+1);napi_get_value_string_utf8(env,argv[2],text.data(),text.size(),&size);data=text.data();bytes=text.size();}
        else if(type!=napi_null&&type!=napi_undefined) {
            bool typed=false,buffer=false;napi_is_typedarray(env,argv[2],&typed);napi_is_arraybuffer(env,argv[2],&buffer);
            if(typed) {napi_typedarray_type element;size_t count=0,offset=0;napi_value backing;napi_get_typedarray_info(env,argv[2],&element,&count,&data,&backing,&offset);const size_t widths[]={1,1,1,2,2,4,4,4,8,8,8};if(size_t(element)>=std::size(widths)){napi_throw_type_error(env,nullptr,"Unsupported raw GL typed array");return nullptr;}bytes=count*widths[element];}
            else if(buffer)napi_get_arraybuffer_info(env,argv[2],&data,&bytes);
            else {napi_throw_type_error(env,nullptr,"Raw GL data must be a typed array, ArrayBuffer or string");return nullptr;}
        }
    }
    TNRawGLResult result{};tn_raw_gl_call(op,args.data(),data,bytes,data,&result);
    napi_value value;
    if(result.kind==-1){napi_throw_error(env,nullptr,result.text);return nullptr;}
    if(result.kind==1)napi_create_double(env,result.values[0],&value);
    else if(result.kind==3)napi_create_string_utf8(env,result.text,NAPI_AUTO_LENGTH,&value);
    else if(result.kind==4) {
        napi_create_object(env,&value);napi_value field;napi_create_string_utf8(env,result.text,NAPI_AUTO_LENGTH,&field);napi_set_named_property(env,value,"name",field);
        napi_create_double(env,result.values[0],&field);napi_set_named_property(env,value,"size",field);napi_create_double(env,result.values[1],&field);napi_set_named_property(env,value,"type",field);
    } else if(result.kind==5) {napi_create_array_with_length(env,result.count,&value);for(int i=0;i<result.count;i++){napi_value field;napi_create_double(env,result.values[i],&field);napi_set_element(env,value,i,field);}}
    else napi_get_undefined(env,&value);
    return value;
}
napi_value reset(napi_env env,napi_callback_info) {tn_raw_gl_reset();napi_value value;napi_get_undefined(env,&value);return value;}

}
void registerRawGL(napi_env env,napi_value exports) {
    napi_property_descriptor properties[]={{"rawGlCall",nullptr,call,nullptr,nullptr,nullptr,napi_default,nullptr},{"rawGlReset",nullptr,reset,nullptr,nullptr,nullptr,napi_default,nullptr}};
    napi_define_properties(env,exports,std::size(properties),properties);
}
