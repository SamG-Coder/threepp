#pragma once

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <string>
#include <unordered_map>
#include <unordered_set>

namespace threepp::gl {

// Classifies only a small GLSL expression grammar. Degree 0 is constant over
// a primitive, 1 is affine in source attributes, 2 is unknown/nonlinear.
// Affine operations commute with barycentric interpolation. This does not
// prove arbitrary GLSL or bound the final fragment shader's sensitivity.
inline int affineExpressionDegree(const std::string& expression, const std::unordered_map<std::string,int>& symbols) {
    struct Parser {
        const std::string& text;
        const std::unordered_map<std::string,int>& symbols;
        size_t pos{};
        unsigned values{};
        bool valid=true;
        void space() { while(pos<text.size() && std::isspace(static_cast<unsigned char>(text[pos]))) ++pos; }
        bool take(char c) { space(); if(pos<text.size() && text[pos]==c) { ++pos; return true; } return false; }
        std::string identifier() {
            space(); const auto start=pos;
            if(pos<text.size() && (std::isalpha(static_cast<unsigned char>(text[pos])) || text[pos]=='_')) {
                ++pos;
                while(pos<text.size() && (std::isalnum(static_cast<unsigned char>(text[pos])) || text[pos]=='_')) ++pos;
            }
            return text.substr(start,pos-start);
        }
        int sum() {
            int result=product();
            while(true) {
                if(take('+') || take('-')) result=std::max(result,product());
                else return result;
            }
        }
        int product() {
            int result=value();
            while(true) {
                if(take('*')) result=std::min(2,result+value());
                else if(take('/')) { if(value()!=0) result=2; }
                else return result;
            }
        }
        int value() {
            if(++values>256) { valid=false; return 2; }
            space(); int result=2;
            if(pos>=text.size()) { valid=false; return 2; }
            if(take('+') || take('-')) return value();
            if(take('(')) {
                result=sum(); if(!take(')')) valid=false;
            } else if(std::isdigit(static_cast<unsigned char>(text[pos])) || text[pos]=='.') {
                char* end=nullptr;
                std::strtod(text.c_str()+pos,&end);
                if(end==text.c_str()+pos) { valid=false; ++pos; return 2; }
                pos=end-text.c_str(); result=0;
            } else {
                const auto name=identifier();
                if(name.empty()) { valid=false; ++pos; return 2; }
                if(take('(')) {
                    static const std::unordered_set<std::string> constructors{"float","vec2","vec3","vec4","mat2","mat3","mat4"};
                    if(!constructors.contains(name)) { valid=false; return 2; }
                    result=sum();
                    while(take(',')) result=std::max(result,sum());
                    if(!take(')')) valid=false;
                } else {
                    const auto it=symbols.find(name);
                    result=it!=symbols.end() && it->second>=0 ? it->second : 2;
                }
            }
            while(true) {
                if(take('.')) {
                    auto swizzle=identifier();
                    if(swizzle.empty() || swizzle.size()>4 || swizzle.find_first_not_of("xyzwrgbastpq")!=std::string::npos) valid=false;
                } else if(take('[')) {
                    if(sum()!=0 || !take(']')) valid=false;
                } else return result;
            }
        }
    } parser{expression,symbols};
    const int result=parser.sum(); parser.space();
    return parser.valid && parser.pos==expression.size() ? result : 2;
}
}
