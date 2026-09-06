
#ifdef ALPHATEST

	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( ALPHATEST, ALPHATEST + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < ALPHATEST ) discard;
	#endif

#endif

