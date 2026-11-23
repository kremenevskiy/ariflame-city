/* Флейм-Сити — модели машин из cars/cars-<хэш>.glb (сборка tools/fc-cars-build.cjs): докачиваются после старта
 * игры и подменяют коробки-заглушки на лету (FC.cars.setModels). Не загрузились — играем на заглушках.
 *
 * В файле: узел на тип машины (id из fcarlist.js; в extras — колёса, маячки, посадка), lod_<силуэт> — дальний план,
 * wheel_<стиль> — колёса единичного размера. Вершины: POSITION, NORMAL, COLOR_0 = RGBA8 (a — вид поверхности, см.
 * материал в fcars.js). Позиции сжаты meshopt + квантованы: переводим во float с матрицей узла.
 */
(function (global) {
  "use strict";
  var FC = global.FC, T = global.THREE;
  var GLB = "cars/cars-f66db5ce.glb";
  if (!FC || !FC.cars || !FC.cars.setModels || !T || !T.GLTFLoader) return;

  var v = new T.Vector3();
  // геометрия узла → наш формат: позиция float (с матрицей узла), нормаль как есть, цвет RGB8 + kind
  function convert(src, mw) {
    var p = src.attributes.position, c = src.attributes.color, n = p.count;
    var P = new Float32Array(n * 3), Cc = new Uint8Array(n * 3), Kd = new Uint8Array(n);
    for (var i = 0; i < n; i++) {
      v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(mw);
      P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
      Cc[i * 3] = Math.round(c.getX(i) * 255); Cc[i * 3 + 1] = Math.round(c.getY(i) * 255); Cc[i * 3 + 2] = Math.round(c.getZ(i) * 255);
      Kd[i] = Math.round(c.getW(i) * 255);
    }
    var g = new T.BufferGeometry();
    g.setAttribute("position", new T.BufferAttribute(P, 3));
    g.setAttribute("normal", src.attributes.normal);
    g.setAttribute("color", new T.BufferAttribute(Cc, 3, true));
    g.setAttribute("kind", new T.BufferAttribute(Kd, 1));
    g.setIndex(src.index);
    g.computeBoundingSphere();
    return g;
  }
  function load() {
    var t0 = performance.now(), L = new T.GLTFLoader();
    if (T.MeshoptDecoder) L.setMeshoptDecoder(T.MeshoptDecoder);
    L.load(GLB, function (gl) {
      var pack = { types: {}, lods: {}, wheels: {} };
      gl.scene.updateMatrixWorld(true);
      gl.scene.traverse(function (o) {
        if (!o.isMesh || !o.geometry.attributes.color) return;
        var name = o.name, ex = o.userData || {}, geo = convert(o.geometry, o.matrixWorld);
        o.geometry.dispose();
        if (/^lod_/.test(name)) pack.lods[name.slice(4)] = { geo: geo };
        else if (/^wheel_/.test(name)) pack.wheels[name.slice(6)] = geo;
        else pack.types[name] = { geo: geo, wheels: ex.wheels || [], wheelStyle: ex.wheel || "alloy", tireW: ex.tireW || 0.22,
          beacons: ex.beacons || null, seat: ex.seat || null };
      });
      FC.cars.setModels(pack);
      FC.cars.glbMs = Math.round(performance.now() - t0);
    }, undefined, function (e) {
      if (global.console) console.warn("машины: модели не загрузились, остаются заглушки", e && e.message);
    });
  }
  // после старта и первых кадров: город важнее; ?cars=box — оставить заглушки (сравнение и отладка)
  var q = (global.location && global.location.search) || "";
  if (!/[?&]cars=box/.test(q)) FC.on("start", function () { setTimeout(load, 1200); });
})(window);
