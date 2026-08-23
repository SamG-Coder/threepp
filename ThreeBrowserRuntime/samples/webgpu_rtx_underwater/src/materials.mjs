import {
	BackSide,
	DoubleSide,
	MeshBasicNodeMaterial,
	MeshPhysicalNodeMaterial
} from 'three/webgpu';
import {
	abs,
	bumpMap,
	cameraPosition,
	color,
	cos,
	dot,
	float,
	length,
	mix,
	mx_fractal_noise_float,
	mx_noise_float,
	normalWorld,
	normalize,
	positionLocal,
	positionWorld,
	pow,
	reflect,
	saturate,
	screenUV,
	sin,
	smoothstep,
	uniform,
	vec2,
	viewportTexture,
	vec3
} from 'three/tsl';

// One clock drives both the displaced water and the projected caustic field. Keeping
// them phase-locked prevents the familiar "scrolling caustic texture" look.
export const waterTime = uniform( 0 );
export const causticStrength = uniform( 0.68 );

// Restrained Gerstner-like wave components for calm, shallow tropical water. The
// derivatives below are analytic, so water normals remain coherent with displacement.
const WAVES = Object.freeze( [
	{ x: 0.94, z: 0.34, frequency: 0.62, speed: 0.72, amplitude: 0.135 },
	{ x: - 0.38, z: 0.92, frequency: 1.08, speed: - 0.66, amplitude: 0.080 },
	{ x: 0.67, z: - 0.74, frequency: 1.92, speed: 1.04, amplitude: 0.045 },
	{ x: - 0.86, z: - 0.51, frequency: 3.15, speed: - 1.28, amplitude: 0.022 },
	{ x: 0.18, z: - 0.98, frequency: 5.80, speed: 1.86, amplitude: 0.010 },
	{ x: - 0.73, z: 0.68, frequency: 9.10, speed: - 2.22, amplitude: 0.0045 }
] );

function wavePhase( point, wave ) {

	return point.x.mul( wave.x )
		.add( point.z.mul( wave.z ) )
		.mul( wave.frequency )
		.add( waterTime.mul( wave.speed ) );

}

function waveHeight( point ) {

	let height = float( 0 );

	for ( const wave of WAVES ) {

		height = height.add( sin( wavePhase( point, wave ) ).mul( wave.amplitude ) );

	}

	return height;

}

function waveUndersideNormal( point ) {

	let derivativeX = float( 0 );
	let derivativeZ = float( 0 );

	for ( const wave of WAVES ) {

		const slope = cos( wavePhase( point, wave ) )
			.mul( wave.amplitude * wave.frequency );

		derivativeX = derivativeX.add( slope.mul( wave.x ) );
		derivativeZ = derivativeZ.add( slope.mul( wave.z ) );

	}

	// This demo observes the surface from below, hence the deliberately downward
	// normal. It is the exact derivative of the displacement used above.
	return normalize( vec3( derivativeX, - 1, derivativeZ ) );

}

function causticField( point, surfaceNormal ) {

	// The narrow ridges approximate wave-lens convergence using the exact phases of
	// the surface waves. Low-frequency turbulence breaks the regular screen-door
	// intersections into the wandering lens network visible in real shallow water.
	// This is procedural raster shading, not a ray-traced caustic.
	const warpX = mx_fractal_noise_float(
		point.mul( vec3( 0.34, 0.09, 0.34 ) ), 3, 2.07, 0.51
	);
	const warpZ = mx_fractal_noise_float(
		point.add( vec3( 7.3, 1.7, - 4.9 ) ).mul( vec3( 0.29, 0.08, 0.29 ) ), 3, 2.11, 0.49
	);
	const warpedPoint = point.add( vec3( warpX.mul( 1.34 ), 0, warpZ.mul( 1.34 ) ) );
	const p0 = wavePhase( warpedPoint, WAVES[ 0 ] );
	const p1 = wavePhase( warpedPoint, WAVES[ 1 ] );
	const p2 = wavePhase( warpedPoint, WAVES[ 2 ] );
	const p3 = wavePhase( warpedPoint, WAVES[ 3 ] );

	const microA = wavePhase( warpedPoint, WAVES[ 4 ] );
	const microB = wavePhase( warpedPoint, WAVES[ 5 ] );
	const bandA = sin(
		p0.mul( 24.0 )
			.add( sin( p1.mul( 9.1 ) ).mul( 1.34 ) )
			.add( sin( microA.mul( 2.1 ) ).mul( 0.52 ) )
	);
	const bandB = sin(
		p1.mul( 19.0 )
			.sub( sin( p2.mul( 7.4 ) ).mul( 1.10 ) )
			.add( sin( microB.mul( 1.7 ) ).mul( 0.46 ) )
	);
	const bandC = sin(
		p2.mul( 14.0 )
			.add( p3.mul( 5.2 ) )
			.add( sin( p0.mul( 6.3 ) ).mul( 0.94 ) )
	);
	const distanceA = saturate( float( 1 ).sub( abs( bandA ) ) );
	const distanceB = saturate( float( 1 ).sub( abs( bandB ) ) );
	const distanceC = saturate( float( 1 ).sub( abs( bandC ) ) );
	const coreA = pow( distanceA, 9.0 );
	const coreB = pow( distanceB, 8.5 );
	const coreC = pow( distanceC, 8.0 );
	const haloA = pow( distanceA, 3.8 );
	const haloB = pow( distanceB, 3.6 );
	const haloC = pow( distanceC, 3.5 );
	const convergence = saturate(
		coreA.mul( 0.12 )
			.add( coreB.mul( 0.10 ) )
			.add( coreC.mul( 0.09 ) )
			.add( coreA.mul( coreB ).mul( 1.48 ) )
			.add( coreB.mul( coreC ).mul( 1.16 ) )
			.add( coreC.mul( coreA ).mul( 0.92 ) )
			.add( haloA.add( haloB ).add( haloC ).mul( 0.027 ) )
	);
	const receivingAngle = saturate( abs( surfaceNormal.y ).mul( 0.66 ).add( 0.34 ) );
	const receiverDepth = float( 2.9 ).sub( point.y ).max( 0 );
	const depthFocus = receiverDepth.mul( - 0.105 ).exp().mul( 0.58 ).add( 0.42 );

	return convergence.mul( receivingAngle ).mul( depthFocus ).mul( causticStrength ).saturate();

}

function causticLitColor( baseColor, grain, ambientScale = 0.82, highlightScale = 1.28 ) {

	const caustic = causticField( positionWorld, normalWorld );
	const quietBase = baseColor.mul( grain ).mul( ambientScale );
	const warmFocus = baseColor.mul( grain ).mul( highlightScale )
		.add( color( 0xfff4de ).mul( 0.055 ) );
	const directLit = mix( quietBase, warmFocus, caustic );

	// Approximate Beer-Lambert extinction over the real camera-to-fragment path.
	// Red light disappears first in water, while a restrained turquoise in-scatter
	// gradually replaces contrast in the distance. This is deliberately applied to
	// every solid receiver so rocks, fish and sand share one coherent water volume.
	const viewDistance = length( positionWorld.sub( cameraPosition ) ).sub( 2.0 ).max( 0 );
	const absorption = vec3( 0.047, 0.021, 0.0105 );
	const transmission = absorption.mul( viewDistance ).negate().exp();
	const lostLight = float( 1 ).sub(
		transmission.x.mul( 0.30 )
			.add( transmission.y.mul( 0.50 ) )
			.add( transmission.z.mul( 0.20 ) )
	).saturate();
	const inScatter = color( 0x319b91 ).mul( lostLight.mul( 0.21 ) );

	return directLit.mul( transmission ).add( inScatter );

}

export function createWaterMaterial() {

	const material = new MeshBasicNodeMaterial( {
		name: 'Underwater surface',
		side: DoubleSide,
		transparent: true,
		opacity: 1,
		depthWrite: false,
		fog: false
	} );

	material.positionNode = vec3(
		positionLocal.x,
		positionLocal.y.add( waveHeight( positionLocal ) ),
		positionLocal.z
	);

	const surfaceNormal = waveUndersideNormal( positionLocal );
	const viewDirection = normalize( cameraPosition.sub( positionWorld ) );
	const fresnel = pow(
		saturate( float( 1 ).sub( abs( dot( surfaceNormal, viewDirection ) ) ) ),
		5
	);
	const broadCell = sin(
		wavePhase( positionLocal, WAVES[ 0 ] ).mul( 2.15 )
			.add( sin( wavePhase( positionLocal, WAVES[ 1 ] ).mul( 1.08 ) ).mul( 0.88 ) )
	);
	const crossingCell = sin(
		wavePhase( positionLocal, WAVES[ 2 ] ).mul( 1.12 )
			.sub( sin( wavePhase( positionLocal, WAVES[ 3 ] ).mul( 0.74 ) ).mul( 0.61 ) )
	);
	const cellRidge = pow(
		saturate( float( 1 ).sub( abs( broadCell.mul( 0.72 ).add( crossingCell.mul( 0.28 ) ) ) ) ),
		4.2
	);
	const sunDirection = normalize( vec3( 0.42, 0.88, - 0.22 ) );
	const sunFacing = pow(
		saturate( abs( dot( surfaceNormal, sunDirection ) ) ),
		24
	);
	const waterLight = fresnel.mul( 0.46 )
		.add( cellRidge.mul( 0.34 ) )
		.add( sunFacing.mul( 0.38 ) )
		.add( 0.055 )
		.saturate();

	// Copy the already-rendered opaque viewport and perturb it with the exact
	// analytic surface normal. From below this supplies the moving refracted
	// ceiling that dominates the reference footage, while the restrained cream
	// reflection and Fresnel term retain a readable sunlit underside.
	const distortion = vec2( surfaceNormal.x, surfaceNormal.z )
		.mul( mix( float( 0.022 ), float( 0.052 ), cellRidge ) );
	const refracted = viewportTexture( screenUV.add( distortion ) ).rgb;

	// The camera is below the surface, so reflect its incident view ray through the
	// analytic underside normal to synthesize the air-side environment that the
	// opaque underwater prepass cannot contain. This deliberately stays procedural:
	// it is a raster reflection, not a claimed ray-traced result.
	const airRay = normalize( reflect( viewDirection, surfaceNormal ) );
	const airElevation = saturate( airRay.y.mul( 1.75 ).add( 0.12 ) );
	const skyGradient = mix(
		color( 0xeee4ce ),
		color( 0x4f96bd ),
		pow( airElevation, 0.48 )
	);
	const shorelineBand = float( 1 ).sub(
		smoothstep( 0.025, 0.145, abs( airRay.y.sub( 0.055 ) ) )
	);
	const airReflection = mix(
		skyGradient,
		color( 0x3f5750 ),
		shorelineBand.mul( 0.68 )
	);
	// MaterialX fractal noise avoids the broad, flat sine islands that made the
	// reflected sky resemble painted blobs. The water normal supplies the motion.
	const cloudCoarse = mx_fractal_noise_float(
		airRay.mul( vec3( 4.6, 2.15, 4.6 ) ), 5, 2.03, 0.52
	).mul( 0.5 ).add( 0.5 );
	const cloudDetail = mx_fractal_noise_float(
		airRay.mul( vec3( 11.8, 5.2, 11.8 ) ), 3, 2.11, 0.48
	).mul( 0.5 ).add( 0.5 );
	const cloudSignal = cloudCoarse.mul( 0.78 ).add( cloudDetail.mul( 0.22 ) );
	const cloudMask = smoothstep( 0.54, 0.73, cloudSignal )
		.mul( smoothstep( 0.12, 0.55, airElevation ) );
	const skyWithClouds = mix( airReflection, color( 0xe8e4d8 ), cloudMask.mul( 0.17 ) );
	const sunAlignment = saturate( dot( airRay, sunDirection ) );
	const sunHalo = pow( sunAlignment, 13.0 );
	const sunGlint = pow( sunAlignment, 110.0 );
	const reflectionWeight = mix( float( 0.09 ), float( 0.86 ), fresnel ).saturate();
	material.colorNode = mix( refracted, skyWithClouds, reflectionWeight )
		.add( color( 0xffedcb ).mul( sunHalo.mul( 0.16 ) ) )
		.add( color( 0xfff7dd ).mul( sunGlint.mul( 0.95 ) ) )
		.add( color( 0xffffff ).mul( sunFacing.mul( 0.055 ) ) );
	material.opacityNode = mix(
		float( 0.72 ),
		float( 0.96 ),
		fresnel.mul( 0.72 ).add( cellRidge.mul( 0.28 ) ).saturate()
	);

	// The transparent Fresnel tint is a WebGPU raster approximation. The fixed RTX
	// hook used by this demo controls Reflex only; it exposes no refraction rays.
	return material;

}

export function createSandMaterial( baseHex = 0xd0d0c7 ) {

	const material = new MeshPhysicalNodeMaterial( {
		name: 'Caustic sand',
		side: DoubleSide,
		metalness: 0,
		roughness: 0.94,
		clearcoat: 0,
		ior: 1.42
	} );

	const broadNoise = mx_fractal_noise_float(
		positionWorld.mul( vec3( 0.82, 0.20, 0.82 ) ), 4, 2.03, 0.52
	).mul( 0.5 ).add( 0.5 );
	const grainNoise = mx_noise_float(
		positionWorld.mul( vec3( 9.4, 2.1, 9.4 ) )
	).mul( 0.5 ).add( 0.5 );
	const gritNoise = mx_noise_float(
		positionWorld.mul( vec3( 27.0, 5.0, 27.0 ) )
	).mul( 0.5 ).add( 0.5 );
	const speckSignal = grainNoise.mul( gritNoise );
	const broadGrain = mix( float( 0.78 ), float( 1.10 ), smoothstep( 0.12, 0.88, broadNoise ) );
	const fineGrain = mix( float( 0.84 ), float( 1.105 ), smoothstep( 0.18, 0.84, grainNoise ) );
	const darkSpecks = pow( smoothstep( 0.66, 0.93, speckSignal ), 2.5 ).mul( 0.30 );
	const grain = broadGrain.mul( fineGrain ).sub( darkSpecks );

	material.colorNode = causticLitColor( color( baseHex ), grain, 0.79, 1.40 );
	material.normalNode = bumpMap(
		broadNoise.mul( 0.14 ).add( grainNoise.mul( 0.042 ) ).add( gritNoise.mul( 0.012 ) ),
		0.46
	);
	material.roughnessNode = mix( float( 0.87 ), float( 0.99 ), grainNoise );
	return material;

}

export function createRockMaterial( baseHex = 0x53615c ) {

	const material = new MeshPhysicalNodeMaterial( {
		name: 'Caustic rock',
		metalness: 0,
		roughness: 0.80,
		clearcoat: 0.065,
		clearcoatRoughness: 0.68,
		ior: 1.47
	} );

	const rockMacro = mx_fractal_noise_float( positionWorld.mul( 0.86 ), 4, 2.07, 0.51 )
		.mul( 0.5 ).add( 0.5 );
	const rockPore = mx_noise_float( positionWorld.mul( 8.7 ) ).mul( 0.5 ).add( 0.5 );
	const rockFine = mx_noise_float( positionWorld.mul( 21.0 ) ).mul( 0.5 ).add( 0.5 );
	const strata = sin( positionWorld.y.mul( 3.15 )
		.add( positionWorld.x.mul( 0.28 ) )
		.sub( positionWorld.z.mul( 0.21 ) )
		.add( rockMacro.mul( 2.4 ) ) )
		.mul( 0.5 ).add( 0.5 );
	const mineral = rockPore.mul( 0.72 ).add( rockFine.mul( 0.28 ) );
	const broadTone = mix( float( 0.77 ), float( 1.12 ), smoothstep( 0.12, 0.9, strata ) );
	const poreTone = mix( float( 0.76 ), float( 1.09 ), smoothstep( 0.16, 0.86, mineral ) );
	const topLight = smoothstep( - 0.12, 0.82, normalWorld.y );
	const mineralTint = mix(
		color( baseHex ).mul( 0.84 ).add( color( 0x344c44 ).mul( 0.035 ) ),
		color( baseHex ),
		topLight.mul( 0.52 ).add( 0.43 )
	);
	const algaeMask = smoothstep( 0.56, 0.80, rockMacro )
		.mul( smoothstep( 0.16, 0.74, normalWorld.y ) )
		.mul( smoothstep( 0.34, 0.76, rockPore ) );
	const weatheredTint = mix( mineralTint, color( 0x3f704d ), algaeMask.mul( 0.54 ) );
	const grain = broadTone.mul( poreTone );

	material.colorNode = causticLitColor( weatheredTint, grain, 0.84, 1.43 );
	material.normalNode = bumpMap(
		rockMacro.mul( 0.18 ).add( rockPore.mul( 0.050 ) ).add( rockFine.mul( 0.012 ) ),
		0.39
	);
	const wetFacing = smoothstep( - 0.04, 0.86, normalWorld.y )
		.mul( smoothstep( 0.34, 0.82, rockMacro ) );
	material.roughnessNode = mix( float( 0.76 ), float( 0.94 ), mineral )
		.sub( wetFacing.mul( 0.10 ) )
		.max( 0.62 );
	material.clearcoatNode = mix( float( 0.045 ), float( 0.21 ), wetFacing );
	material.clearcoatRoughnessNode = mix( float( 0.68 ), float( 0.34 ), wetFacing );
	return material;

}

export function createFishMaterial( baseHex = 0x708c8a, emissiveHex = 0x000000 ) {

	const material = new MeshPhysicalNodeMaterial( {
		name: 'Fish scales',
		metalness: 0.02,
		roughness: 0.44,
		clearcoat: 0.075,
		clearcoatRoughness: 0.43,
		ior: 1.38,
		iridescence: 0.030,
		iridescenceIOR: 1.3,
		iridescenceThicknessRange: [ 90, 220 ],
		sheen: 0.08,
		sheenRoughness: 0.48,
		sheenColor: 0x759b96
	} );

	const flankVariation = sin( positionLocal.z.mul( 12.4 )
		.add( positionLocal.y.mul( 8.2 ) ) )
		.mul( 0.5 ).add( 0.5 );
	const belly = float( 1 ).sub( smoothstep( - 0.24, 0.24, positionLocal.y ) );
	const dorsalShade = smoothstep( 0.04, 0.34, positionLocal.y );
	const scaleGlimmer = pow( smoothstep( 0.64, 0.96, flankVariation ), 2.2 );
	const grain = mix( float( 0.90 ), float( 1.055 ), flankVariation )
		.add( belly.mul( 0.10 ) )
		.add( scaleGlimmer.mul( 0.035 ) );

	const bodyColor = color( baseHex )
		.mul( mix( float( 0.80 ), float( 1.055 ), belly ) )
		.mul( mix( float( 1.0 ), float( 0.76 ), dorsalShade ) );
	material.colorNode = causticLitColor( bodyColor, grain, 0.86, 1.22 )
		.add( color( baseHex ).mul( 0.055 ) );
	material.emissiveNode = color( emissiveHex ).mul( 0.045 );
	return material;

}

export function createSkyMaterial() {

	const material = new MeshBasicNodeMaterial( {
		name: 'Underwater backdrop',
		side: BackSide,
		depthWrite: false,
		fog: false
	} );

	const viewRay = normalize( positionWorld.sub( cameraPosition ) );
	const elevation = saturate( viewRay.y.mul( 0.5 ).add( 0.5 ) );
	const horizon = smoothstep( 0.12, 0.82, elevation );
	const sunDirection = normalize( vec3( 0.42, 0.88, - 0.22 ) );
	const sunGlow = pow( saturate( dot( viewRay, sunDirection ) ), 72 );

	const base = mix( color( 0x268e88 ), color( 0x75b8bd ), horizon );
	material.colorNode = base.add( color( 0xffefd0 ).mul( sunGlow.mul( 0.42 ) ) );

	// This is a simple raster backdrop, not an environment ray or a ray-traced sky.
	return material;

}

export function updateWaterTime( seconds ) {

	waterTime.value = Number.isFinite( seconds ) ? seconds : 0;

}
