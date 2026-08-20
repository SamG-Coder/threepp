(function (TN) {
  "use strict";

  TN.REVISION = "native-threepp";

  TN.MOUSE = { LEFT: 0, MIDDLE: 1, RIGHT: 2, ROTATE: 0, DOLLY: 1, PAN: 2 };
  TN.TOUCH = { ROTATE: 0, PAN: 1, DOLLY_PAN: 2, DOLLY_ROTATE: 3 };

  TN.CullFaceNone = 0;
  TN.CullFaceBack = 1;
  TN.CullFaceFront = 2;
  TN.CullFaceFrontBack = 3;

  TN.BasicShadowMap = 0;
  TN.PCFShadowMap = 1;
  TN.PCFSoftShadowMap = 2;
  TN.VSMShadowMap = 3;

  TN.FrontSide = 0;
  TN.BackSide = 1;
  TN.DoubleSide = 2;

  TN.NoBlending = 0;
  TN.NormalBlending = 1;
  TN.AdditiveBlending = 2;
  TN.SubtractiveBlending = 3;
  TN.MultiplyBlending = 4;
  TN.CustomBlending = 5;
  TN.MaterialBlending = 6;

  TN.AddEquation = 100;
  TN.SubtractEquation = 101;
  TN.ReverseSubtractEquation = 102;
  TN.MinEquation = 103;
  TN.MaxEquation = 104;

  TN.ZeroFactor = 200;
  TN.OneFactor = 201;
  TN.SrcColorFactor = 202;
  TN.OneMinusSrcColorFactor = 203;
  TN.SrcAlphaFactor = 204;
  TN.OneMinusSrcAlphaFactor = 205;
  TN.DstAlphaFactor = 206;
  TN.OneMinusDstAlphaFactor = 207;
  TN.DstColorFactor = 208;
  TN.OneMinusDstColorFactor = 209;
  TN.SrcAlphaSaturateFactor = 210;
  TN.ConstantColorFactor = 211;
  TN.OneMinusConstantColorFactor = 212;
  TN.ConstantAlphaFactor = 213;
  TN.OneMinusConstantAlphaFactor = 214;

  TN.NeverDepth = 0;
  TN.AlwaysDepth = 1;
  TN.LessDepth = 2;
  TN.LessEqualDepth = 3;
  TN.EqualDepth = 4;
  TN.GreaterEqualDepth = 5;
  TN.GreaterDepth = 6;
  TN.NotEqualDepth = 7;

  TN.MultiplyOperation = 0;
  TN.MixOperation = 1;
  TN.AddOperation = 2;

  TN.NoToneMapping = 0;
  TN.LinearToneMapping = 1;
  TN.ReinhardToneMapping = 2;
  TN.CineonToneMapping = 3;
  TN.ACESFilmicToneMapping = 4;
  TN.CustomToneMapping = 5;
  TN.AgXToneMapping = 6;
  TN.NeutralToneMapping = 7;

  TN.AttachedBindMode = "attached";
  TN.DetachedBindMode = "detached";

  TN.UVMapping = 300;
  TN.CubeReflectionMapping = 301;
  TN.CubeRefractionMapping = 302;
  TN.EquirectangularReflectionMapping = 303;
  TN.EquirectangularRefractionMapping = 304;
  TN.CubeUVReflectionMapping = 306;

  TN.RepeatWrapping = 1000;
  TN.ClampToEdgeWrapping = 1001;
  TN.MirroredRepeatWrapping = 1002;

  TN.NearestFilter = 1003;
  TN.NearestMipmapNearestFilter = 1004;
  TN.NearestMipMapNearestFilter = 1004;
  TN.NearestMipmapLinearFilter = 1005;
  TN.NearestMipMapLinearFilter = 1005;
  TN.LinearFilter = 1006;
  TN.LinearMipmapNearestFilter = 1007;
  TN.LinearMipMapNearestFilter = 1007;
  TN.LinearMipmapLinearFilter = 1008;
  TN.LinearMipMapLinearFilter = 1008;

  TN.UnsignedByteType = 1009;
  TN.ByteType = 1010;
  TN.ShortType = 1011;
  TN.UnsignedShortType = 1012;
  TN.IntType = 1013;
  TN.UnsignedIntType = 1014;
  TN.FloatType = 1015;
  TN.HalfFloatType = 1016;
  TN.UnsignedShort4444Type = 1017;
  TN.UnsignedShort5551Type = 1018;
  TN.UnsignedInt248Type = 1020;
  TN.UnsignedInt5999Type = 35902;
  TN.UnsignedInt101111Type = 35899;

  TN.AlphaFormat = 1021;
  TN.RGBFormat = 1022;
  TN.RGBAFormat = 1023;
  TN.DepthFormat = 1026;
  TN.DepthStencilFormat = 1027;
  TN.RedFormat = 1028;
  TN.RedIntegerFormat = 1029;
  TN.RGFormat = 1030;
  TN.RGIntegerFormat = 1031;
  TN.RGBIntegerFormat = 1032;
  TN.RGBAIntegerFormat = 1033;

  TN.RGB_S3TC_DXT1_Format = 33776;
  TN.RGBA_S3TC_DXT1_Format = 33777;
  TN.RGBA_S3TC_DXT3_Format = 33778;
  TN.RGBA_S3TC_DXT5_Format = 33779;

  TN.RGB_PVRTC_4BPPV1_Format = 35840;
  TN.RGB_PVRTC_2BPPV1_Format = 35841;
  TN.RGBA_PVRTC_4BPPV1_Format = 35842;
  TN.RGBA_PVRTC_2BPPV1_Format = 35843;

  TN.RGB_ETC1_Format = 36196;
  TN.RGB_ETC2_Format = 37492;
  TN.RGBA_ETC2_EAC_Format = 37496;

  TN.R11_EAC_Format = 37488;
  TN.SIGNED_R11_EAC_Format = 37489;
  TN.RG11_EAC_Format = 37490;
  TN.SIGNED_RG11_EAC_Format = 37491;

  TN.RGBA_ASTC_4x4_Format = 37808;
  TN.RGBA_ASTC_5x4_Format = 37809;
  TN.RGBA_ASTC_5x5_Format = 37810;
  TN.RGBA_ASTC_6x5_Format = 37811;
  TN.RGBA_ASTC_6x6_Format = 37812;
  TN.RGBA_ASTC_8x5_Format = 37813;
  TN.RGBA_ASTC_8x6_Format = 37814;
  TN.RGBA_ASTC_8x8_Format = 37815;
  TN.RGBA_ASTC_10x5_Format = 37816;
  TN.RGBA_ASTC_10x6_Format = 37817;
  TN.RGBA_ASTC_10x8_Format = 37818;
  TN.RGBA_ASTC_10x10_Format = 37819;
  TN.RGBA_ASTC_12x10_Format = 37820;
  TN.RGBA_ASTC_12x12_Format = 37821;

  TN.RGBA_BPTC_Format = 36492;
  TN.RGB_BPTC_SIGNED_Format = 36494;
  TN.RGB_BPTC_UNSIGNED_Format = 36495;

  TN.RED_RGTC1_Format = 36283;
  TN.SIGNED_RED_RGTC1_Format = 36284;
  TN.RED_GREEN_RGTC2_Format = 36285;
  TN.SIGNED_RED_GREEN_RGTC2_Format = 36286;

  TN.LoopOnce = 2200;
  TN.LoopRepeat = 2201;
  TN.LoopPingPong = 2202;

  TN.InterpolateDiscrete = 2300;
  TN.InterpolateLinear = 2301;
  TN.InterpolateSmooth = 2302;
  TN.InterpolateBezier = 2303;

  TN.ZeroCurvatureEnding = 2400;
  TN.ZeroSlopeEnding = 2401;
  TN.WrapAroundEnding = 2402;

  TN.NormalAnimationBlendMode = 2500;
  TN.AdditiveAnimationBlendMode = 2501;

  TN.TrianglesDrawMode = 0;
  TN.TriangleStripDrawMode = 1;
  TN.TriangleFanDrawMode = 2;

  TN.BasicDepthPacking = 3200;
  TN.RGBADepthPacking = 3201;
  TN.RGBDepthPacking = 3202;
  TN.RGDepthPacking = 3203;

  TN.TangentSpaceNormalMap = 0;
  TN.ObjectSpaceNormalMap = 1;

  TN.NoColorSpace = "";
  TN.SRGBColorSpace = "srgb";
  TN.LinearSRGBColorSpace = "srgb-linear";

  TN.LinearTransfer = "linear";
  TN.SRGBTransfer = "srgb";

  TN.NoNormalPacking = "";
  TN.NormalRGPacking = "rg";
  TN.NormalGAPacking = "ga";

  TN.ZeroStencilOp = 0;
  TN.KeepStencilOp = 7680;
  TN.ReplaceStencilOp = 7681;
  TN.IncrementStencilOp = 7682;
  TN.DecrementStencilOp = 7683;
  TN.IncrementWrapStencilOp = 34055;
  TN.DecrementWrapStencilOp = 34056;
  TN.InvertStencilOp = 5386;

  TN.NeverStencilFunc = 512;
  TN.LessStencilFunc = 513;
  TN.EqualStencilFunc = 514;
  TN.LessEqualStencilFunc = 515;
  TN.GreaterStencilFunc = 516;
  TN.NotEqualStencilFunc = 517;
  TN.GreaterEqualStencilFunc = 518;
  TN.AlwaysStencilFunc = 519;

  TN.NeverCompare = 512;
  TN.LessCompare = 513;
  TN.EqualCompare = 514;
  TN.LessEqualCompare = 515;
  TN.GreaterCompare = 516;
  TN.NotEqualCompare = 517;
  TN.GreaterEqualCompare = 518;
  TN.AlwaysCompare = 519;

  TN.StaticDrawUsage = 35044;
  TN.DynamicDrawUsage = 35048;
  TN.StreamDrawUsage = 35040;
  TN.StaticReadUsage = 35045;
  TN.DynamicReadUsage = 35049;
  TN.StreamReadUsage = 35041;
  TN.StaticCopyUsage = 35046;
  TN.DynamicCopyUsage = 35050;
  TN.StreamCopyUsage = 35042;

  TN.GLSL1 = "100";
  TN.GLSL3 = "300 es";

  TN.WebGLCoordinateSystem = 2000;
  TN.WebGPUCoordinateSystem = 2001;

  TN.TimestampQuery = {
    COMPUTE: "compute",
    RENDER: "render",
  };

  TN.InterpolationSamplingType = {
    PERSPECTIVE: "perspective",
    LINEAR: "linear",
    FLAT: "flat",
  };

  TN.InterpolationSamplingMode = {
    NORMAL: "normal",
    CENTROID: "centroid",
    SAMPLE: "sample",
    FIRST: "first",
    EITHER: "either",
  };

  TN.Compatibility = {
    TEXTURE_COMPARE: "depthTextureCompare",
  };

  TN.RenderObjectRefreshType = {
    NONE: 0,
    SHARED: 1,
    FULL: 2,
  };

  function SRGBToLinear(c) {
    return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
  }

  function LinearToSRGB(c) {
    return c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 0.41666) - 0.055;
  }

  function applyMatrix3(color, e) {
    const r = color.r;
    const g = color.g;
    const b = color.b;
    color.r = e[0] * r + e[3] * g + e[6] * b;
    color.g = e[1] * r + e[4] * g + e[7] * b;
    color.b = e[2] * r + e[5] * g + e[8] * b;
    return color;
  }

  // Matrix3.set() is row-major; .elements is column-major (three.js ColorManagement).
  const LINEAR_REC709_TO_XYZ = [
    0.4123908, 0.212639, 0.0193308,
    0.3575843, 0.7151687, 0.1191948,
    0.1804808, 0.0721923, 0.9505322,
  ];
  const XYZ_TO_LINEAR_REC709 = [
    3.2409699, -0.9692436, 0.0556301,
    -1.5373832, 1.8759675, -0.203977,
    -0.4986108, 0.0415551, 1.0569715,
  ];

  const REC709_PRIMARIES = [0.64, 0.33, 0.3, 0.6, 0.15, 0.06];
  const REC709_LUMINANCE_COEFFICIENTS = [0.2126, 0.7152, 0.0722];
  const D65 = [0.3127, 0.329];

  const ColorManagement = {
    enabled: true,
    workingColorSpace: TN.LinearSRGBColorSpace,
    spaces: {},

    SRGBToLinear: SRGBToLinear,
    LinearToSRGB: LinearToSRGB,

    convert: function (color, sourceColorSpace, targetColorSpace) {
      if (
        this.enabled === false ||
        sourceColorSpace === targetColorSpace ||
        !sourceColorSpace ||
        !targetColorSpace
      ) {
        return color;
      }

      const source = this.spaces[sourceColorSpace];
      const target = this.spaces[targetColorSpace];

      if (source.transfer === TN.SRGBTransfer) {
        color.r = SRGBToLinear(color.r);
        color.g = SRGBToLinear(color.g);
        color.b = SRGBToLinear(color.b);
      }

      if (source.primaries !== target.primaries) {
        applyMatrix3(color, source.toXYZ);
        applyMatrix3(color, target.fromXYZ);
      }

      if (target.transfer === TN.SRGBTransfer) {
        color.r = LinearToSRGB(color.r);
        color.g = LinearToSRGB(color.g);
        color.b = LinearToSRGB(color.b);
      }

      return color;
    },

    workingToColorSpace: function (color, targetColorSpace) {
      return this.convert(color, this.workingColorSpace, targetColorSpace);
    },

    colorSpaceToWorking: function (color, sourceColorSpace) {
      return this.convert(color, sourceColorSpace, this.workingColorSpace);
    },

    getPrimaries: function (colorSpace) {
      return this.spaces[colorSpace].primaries;
    },

    getTransfer: function (colorSpace) {
      if (colorSpace === TN.NoColorSpace) return TN.LinearTransfer;
      return this.spaces[colorSpace].transfer;
    },

    getToneMappingMode: function (colorSpace) {
      return this.spaces[colorSpace].outputColorSpaceConfig.toneMappingMode || "standard";
    },

    getLuminanceCoefficients: function (target, colorSpace) {
      const space = colorSpace === undefined ? this.workingColorSpace : colorSpace;
      return target.fromArray(this.spaces[space].luminanceCoefficients);
    },

    define: function (colorSpaces) {
      Object.assign(this.spaces, colorSpaces);
    },

    _getMatrix: function (targetMatrix, sourceColorSpace, targetColorSpace) {
      const a = this.spaces[sourceColorSpace].toXYZ;
      const b = this.spaces[targetColorSpace].fromXYZ;
      const te = targetMatrix.elements;
      const a11 = a[0], a12 = a[3], a13 = a[6];
      const a21 = a[1], a22 = a[4], a23 = a[7];
      const a31 = a[2], a32 = a[5], a33 = a[8];
      const b11 = b[0], b12 = b[3], b13 = b[6];
      const b21 = b[1], b22 = b[4], b23 = b[7];
      const b31 = b[2], b32 = b[5], b33 = b[8];
      te[0] = a11 * b11 + a12 * b21 + a13 * b31;
      te[1] = a21 * b11 + a22 * b21 + a23 * b31;
      te[2] = a31 * b11 + a32 * b21 + a33 * b31;
      te[3] = a11 * b12 + a12 * b22 + a13 * b32;
      te[4] = a21 * b12 + a22 * b22 + a23 * b32;
      te[5] = a31 * b12 + a32 * b22 + a33 * b32;
      te[6] = a11 * b13 + a12 * b23 + a13 * b33;
      te[7] = a21 * b13 + a22 * b23 + a23 * b33;
      te[8] = a31 * b13 + a32 * b23 + a33 * b33;
      return targetMatrix;
    },

    _getDrawingBufferColorSpace: function (colorSpace) {
      return this.spaces[colorSpace].outputColorSpaceConfig.drawingBufferColorSpace;
    },

    _getUnpackColorSpace: function (colorSpace) {
      const space = colorSpace === undefined ? this.workingColorSpace : colorSpace;
      return this.spaces[space].workingColorSpaceConfig.unpackColorSpace;
    },

    fromWorkingColorSpace: function (color, targetColorSpace) {
      return ColorManagement.workingToColorSpace(color, targetColorSpace);
    },

    toWorkingColorSpace: function (color, sourceColorSpace) {
      return ColorManagement.colorSpaceToWorking(color, sourceColorSpace);
    },
  };

  ColorManagement.define({
    [TN.LinearSRGBColorSpace]: {
      primaries: REC709_PRIMARIES,
      whitePoint: D65,
      transfer: TN.LinearTransfer,
      toXYZ: LINEAR_REC709_TO_XYZ,
      fromXYZ: XYZ_TO_LINEAR_REC709,
      luminanceCoefficients: REC709_LUMINANCE_COEFFICIENTS,
      workingColorSpaceConfig: { unpackColorSpace: TN.SRGBColorSpace },
      outputColorSpaceConfig: { drawingBufferColorSpace: TN.SRGBColorSpace },
    },
    [TN.SRGBColorSpace]: {
      primaries: REC709_PRIMARIES,
      whitePoint: D65,
      transfer: TN.SRGBTransfer,
      toXYZ: LINEAR_REC709_TO_XYZ,
      fromXYZ: XYZ_TO_LINEAR_REC709,
      luminanceCoefficients: REC709_LUMINANCE_COEFFICIENTS,
      outputColorSpaceConfig: { drawingBufferColorSpace: TN.SRGBColorSpace },
    },
  });

  TN.ColorManagement = ColorManagement;
})(globalThis.__TN = globalThis.__TN || {});
