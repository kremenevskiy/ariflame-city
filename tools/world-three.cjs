#!/usr/bin/env node
/* Движок мира (three.js) — один заранее собранный файл client/vendor/three-r160.js.
 *
 * Почему не из npm на лету. Клиент — IIFE-модули на window без сборщика, а three с r150 — только ESM. Поэтому движок
 * собирается один раз этим скриптом и лежит в репо как статика: имя с версией, страница грузит его отдельным тегом.
 *
 * Берём только то, чем пользуется город: tree-shaking esbuild выкидывает остальное (~180 КБ из 650).
 *   node tools/world-three.cjs           — скачать three@0.160.0 (npm pack), собрать, положить в client/vendor/
 */
const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const esbuild = require("esbuild");

const VER = "0.160.0";
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "client/vendor/three-r160.js");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "city-three-"));
execSync(`npm pack three@${VER} --silent`, { cwd: tmp, stdio: "ignore" });
execSync(`tar xzf three-${VER}.tgz`, { cwd: tmp });
fs.mkdirSync(path.join(tmp, "node_modules"));
fs.renameSync(path.join(tmp, "package"), path.join(tmp, "node_modules/three"));

const CORE = [
  "WebGLRenderer", "WebGLRenderTarget", "Scene", "PerspectiveCamera", "Color", "Fog", "Vector2", "Vector3", "Vector4",
  "Matrix4", "Quaternion", "Euler", "Object3D", "Group", "Mesh", "InstancedMesh", "Points", "Sprite",
  "BoxGeometry", "PlaneGeometry", "CylinderGeometry", "ConeGeometry", "SphereGeometry", "TorusGeometry",
  "CircleGeometry", "RingGeometry", "TubeGeometry", "IcosahedronGeometry", "OctahedronGeometry", "BufferGeometry",
  "BufferAttribute", "InstancedBufferAttribute", "Float32BufferAttribute", "MeshStandardMaterial",
  "MeshBasicMaterial", "ShaderMaterial", "PointsMaterial", "SpriteMaterial", "CanvasTexture", "TextureLoader",
  "HemisphereLight", "DirectionalLight", "AmbientLight", "PointLight", "AdditiveBlending", "NormalBlending", "DoubleSide", "FrontSide",
  "BackSide", "SRGBColorSpace", "ACESFilmicToneMapping", "RepeatWrapping", "ClampToEdgeWrapping",
  "LinearFilter", "LinearMipmapLinearFilter", "NearestFilter", "Raycaster", "Clock", "MathUtils", "CatmullRomCurve3",
  "QuadraticBezierCurve3", "Box3", "Plane", "Shape", "ExtrudeGeometry", "LatheGeometry", "HalfFloatType",
  // Флейм-Сити (client/, 22.11.2026): тени солнца, дешёвый материал толпы, фары, отражения на машинах
  "PCFSoftShadowMap", "MeshLambertMaterial", "SpotLight", "DynamicDrawUsage", "PMREMGenerator", "Sphere",
  // люди и машины моделями (22.11): скелет, анимация, данные анимации в текстуре
  "SkinnedMesh", "Skeleton", "Bone", "AnimationMixer", "AnimationClip", "AnimationUtils", "LoopOnce", "LoopRepeat",
  "DataTexture", "FloatType", "RGBAFormat", "LoadingManager", "FileLoader", "KeyframeTrack", "QuaternionKeyframeTrack",
  "VectorKeyframeTrack", "NumberKeyframeTrack", "InstancedInterleavedBuffer", "InterleavedBufferAttribute", "BatchedMesh",
];
const entry = [
  `export { ${CORE.join(", ")} } from "three";`,
  `export { MapControls } from "three/examples/jsm/controls/MapControls.js";`,
  `export { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";`,
  `export { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";`,
  `export { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";`,
  `export { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";`,
  `export { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";`,
  `export { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";`,
  // модели людей и машин: glTF + сжатие meshopt (декодер — чистый JS/WASM внутри модуля, без внешних файлов)
  `export { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";`,
  `export { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";`,
  `export { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";`,
].join("\n");
fs.writeFileSync(path.join(tmp, "entry.js"), entry);
esbuild.buildSync({
  entryPoints: [path.join(tmp, "entry.js")], bundle: true, minify: true, format: "iife",
  globalName: "THREE", target: "es2018", outfile: OUT, legalComments: "none",
  banner: { js: `/* three.js r${VER} (MIT, mrdoob) — сборка tools/world-three.cjs, руками не править */` },
  absWorkingDir: tmp,
});
fs.rmSync(tmp, { recursive: true, force: true });
console.log("three →", path.relative(ROOT, OUT), Math.round(fs.statSync(OUT).size / 1024) + " КБ");
