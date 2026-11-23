"""Флейм-Сити, люди — конвейер ассетов, шаг 2 из 3 (Blender 5.2 без интерфейса).

    blender -b --factory-startup -P tools/fc-humans/build.py -- <загрузки> <рабочая папка> [id ...]

Что делает (список ассетов — assets.json рядом):
  • аватары Microsoft Rocketbox (FBX, скелет 3ds Max Biped на 80 костей) → свой «чистый» скелет на 22 кости с
    именами гуманоида (Hips, Spine…, LeftArm…, RightUpLeg…): веса лица и пальцев сливаются в голову и кисти, бёдра —
    дети таза, ключицы — дети груди (стандарт для будущего рэгдолла). Метры, Y вверх, ступни на нуле, лицом к +Z.
    У всех мужчин скелет один, у всех женщин — свой один: матрицы привязки совпадают, поэтому толпе хватит одной
    текстуры анимации на пол (fhumans.js);
  • три материала (тело, голова, волосы, снаряжение) → один атлас 1024×512 (сдвиг UV), пистолеты из формы — вон;
  • LOD0/1/2 прореживанием (assets.json «lod»), на LOD2 без карточек волос; <id>.glb (сырой) + <id>.uv.json для tex.py;
  • анимации на скелет каждого пола: Rocketbox m_/f_ — мировые повороты костей как есть (оси Biped одинаковые),
    Quaternius UAL1 (риг Rigify) — ретаргет мировыми поворотами с подгонкой покоя по направлениям костей;
    петли — окно с самым похожим началом и концом + разнос невязки по клипу; ходьба и бег — без смещения вперёд
    (скорость шага — в build.json, ей рантайм подгоняет темп), поза «руки вверх» — кодом. → anims_m.glb, anims_f.glb.
Дальше: tex.py (атласы WebP) и pack.cjs (meshopt, квантование). Всё вместе — run.sh.
"""
import bpy
import bmesh
import json
import math
import os
import sys

import numpy as np
from mathutils import Matrix, Quaternion, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
HERE = os.path.dirname(os.path.abspath(__file__))
CFG = json.load(open(os.path.join(HERE, "assets.json")))
DL, OUT = os.path.abspath(argv[0]), os.path.abspath(argv[1])
# фильтры для отладки: id вариантов, «anims» (все клипы), «clip=walk,idle», «g=m»; без аргументов — всё
ONLY = {a for a in argv[2:] if "=" not in a}
OPT = dict(a.split("=", 1) for a in argv[2:] if "=" in a)
CLIPS = set(OPT["clip"].split(",")) if "clip" in OPT else set()
GENDERS = OPT.get("g", "mf")
os.makedirs(OUT, exist_ok=True)
FPS = 30

# Biped → чистый скелет: (кость Biped, имя, родитель в чистом, родитель в Biped). Порядок — родители раньше детей.
BIP = [("Bip01 Pelvis", "Hips", None, None),
       ("Bip01 Spine", "Spine", "Hips", "Bip01 Pelvis"),
       ("Bip01 Spine1", "Spine1", "Spine", "Bip01 Spine"),
       ("Bip01 Spine2", "Spine2", "Spine1", "Bip01 Spine1"),
       ("Bip01 Neck", "Neck", "Spine2", "Bip01 Spine2"),
       ("Bip01 Head", "Head", "Neck", "Bip01 Neck")]
for s, S in (("L", "Left"), ("R", "Right")):
    BIP += [("Bip01 %s Clavicle" % s, S + "Shoulder", "Spine2", "Bip01 Neck"),
            ("Bip01 %s UpperArm" % s, S + "Arm", S + "Shoulder", "Bip01 %s Clavicle" % s),
            ("Bip01 %s Forearm" % s, S + "ForeArm", S + "Arm", "Bip01 %s UpperArm" % s),
            ("Bip01 %s Hand" % s, S + "Hand", S + "ForeArm", "Bip01 %s Forearm" % s)]
for s, S in (("L", "Left"), ("R", "Right")):
    BIP += [("Bip01 %s Thigh" % s, S + "UpLeg", "Hips", "Bip01 Spine"),
            ("Bip01 %s Calf" % s, S + "Leg", S + "UpLeg", "Bip01 %s Thigh" % s),
            ("Bip01 %s Foot" % s, S + "Foot", S + "Leg", "Bip01 %s Calf" % s),
            ("Bip01 %s Toe0" % s, S + "ToeBase", S + "Foot", "Bip01 %s Foot" % s)]
KEEP = {b[0] for b in BIP}
CLEAN = [b[1] for b in BIP]
CPAR = {b[1]: b[2] for b in BIP}
B2C = {b[0]: b[1] for b in BIP}
C2B = {b[1]: b[0] for b in BIP}
BPAR = {b[1]: (B2C[b[3]] if b[3] else None) for b in BIP}      # родитель по Biped, чистыми именами
# Quaternius UAL1 (Rigify DEF-*) → чистый
UAL = {"Hips": "DEF-hips", "Spine": "DEF-spine.001", "Spine1": "DEF-spine.002", "Spine2": "DEF-spine.003",
       "Neck": "DEF-neck", "Head": "DEF-head"}
for s, S in (("L", "Left"), ("R", "Right")):
    UAL.update({S + "Shoulder": "DEF-shoulder." + s, S + "Arm": "DEF-upper_arm." + s, S + "ForeArm": "DEF-forearm." + s,
                S + "Hand": "DEF-hand." + s, S + "UpLeg": "DEF-thigh." + s, S + "Leg": "DEF-shin." + s,
                S + "Foot": "DEF-foot." + s, S + "ToeBase": "DEF-toe." + s})
# куда «смотрит» кость (для подгонки покоя при ретаргете); у концевых — поправка родителя
DIRCHILD = {"Hips": "Spine", "Spine": "Spine1", "Spine1": "Spine2", "Spine2": "Neck", "Neck": "Head"}
for S in ("Left", "Right"):
    DIRCHILD.update({S + "Shoulder": S + "Arm", S + "Arm": S + "ForeArm", S + "ForeArm": S + "Hand",
                     S + "UpLeg": S + "Leg", S + "Leg": S + "Foot", S + "Foot": S + "ToeBase"})
# атлас 1024×512 в координатах UV Blender (u0, v0, su, sv): тело слева 512², справа голова, волосы, снаряжение по 256²
REGION = {"body": (0.0, 0.0, 0.5, 1.0), "head": (0.5, 0.5, 0.25, 0.5), "opacity": (0.75, 0.5, 0.25, 0.5),
          "equip": (0.5, 0.0, 0.25, 0.5)}


def log(*a):
    print("[fc-humans]", *a, flush=True)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.fps = FPS
    sc.render.fps_base = 1


def import_fbx(path):
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=False, use_anim=True)
    objs = [o for o in bpy.context.scene.objects if o not in before]
    arm = next(o for o in objs if o.type == "ARMATURE")
    meshes = [o for o in objs if o.type == "MESH"]
    for o in objs:
        if o.type not in ("ARMATURE", "MESH"):
            bpy.data.objects.remove(o, do_unlink=True)
    return arm, meshes


def select(objs, active=None):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]


def mat_kind(name):
    n = name.lower()
    for k, kind in (("_body", "body"), ("_head", "head"), ("_opacity", "opacity"), ("_equipment", "equip"),
                    ("_hat", "equip"), ("_pistol", "pistol")):
        if k in n:
            return kind
    return "body"


# ---- аватар: чистый скелет, атлас, LOD ------------------------------------------------------------------------

def merge_groups(mo, arm):
    """Веса удаляемых костей (лицо, пальцы, «наконечники») — ближайшему оставшемуся предку."""
    vg = mo.vertex_groups
    names = {g.index: g.name for g in vg}

    def kept(bn):
        b = arm.data.bones.get(bn)
        while b is not None and b.name not in KEEP:
            b = b.parent
        return b.name if b is not None else "Bip01 Pelvis"
    target = {i: kept(n) for i, n in names.items()}
    acc = []
    for v in mo.data.vertices:
        w = {}
        for ge in v.groups:
            t = target.get(ge.group)
            if t:
                w[t] = w.get(t, 0.0) + ge.weight
        acc.append(w)
    for g in list(vg):
        vg.remove(g)
    for b in BIP:
        vg.new(name=b[1])
    for i, w in enumerate(acc):
        s = sum(w.values()) or 1.0
        for n, x in w.items():
            vg[B2C[n]].add([i], x / s, "REPLACE")


def drop_faces(mo, pred):
    bm = bmesh.new()
    bm.from_mesh(mo.data)
    kinds = [mat_kind(m.name) if m else "body" for m in mo.data.materials]
    faces = [f for f in bm.faces if pred(kinds[f.material_index] if f.material_index < len(kinds) else "body")]
    if faces:
        bmesh.ops.delete(bm, geom=faces, context="FACES")
    bm.to_mesh(mo.data)
    bm.free()


def body_tris(mo):
    """Треугольники материала тела: исходные UV и высота вершин (м) — tex.py красит по ним маску верх/низ."""
    me = mo.data
    me.calc_loop_triangles()
    uv = me.uv_layers.active.data
    kinds = [mat_kind(m.name) if m else "body" for m in me.materials]
    out = []
    for t in me.loop_triangles:
        if kinds[t.material_index] != "body":
            continue
        out.append([[round(uv[li].uv[0], 5), round(uv[li].uv[1], 5), round(me.vertices[vi].co.z, 4)]
                    for li, vi in zip(t.loops, t.vertices)])
    return out


def to_atlas(mo):
    me = mo.data
    kinds = [mat_kind(m.name) if m else "body" for m in me.materials]
    uvl = me.uv_layers.active.data
    lo, hi = {}, {}
    for p in me.polygons:
        k = kinds[p.material_index]
        u0, v0, su, sv = REGION[k]
        for li in p.loop_indices:
            u, v = uvl[li].uv
            lo[k] = min(lo.get(k, 9), u, v)
            hi[k] = max(hi.get(k, -9), u, v)
            u, v = min(max(u, 0.0), 1.0), min(max(v, 0.0), 1.0)
            uvl[li].uv = (u0 + u * su, v0 + v * sv)
        p.material_index = 0
    for k in lo:
        if lo[k] < -0.01 or hi[k] > 1.01:
            log("  ⚠ UV вне 0..1:", k, round(lo[k], 3), round(hi[k], 3))
    while len(me.materials) > 1:
        me.materials.pop()
    return sorted(set(kinds))


def prepare(fbx, ground=None):
    """Импорт аватара → (арматура, меш) в метрах, Y вверх (при экспорте), ступни на нуле, чистый скелет."""
    arm, meshes = import_fbx(fbx)
    arm.animation_data_clear()
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix()
    arm.data.pose_position = "REST"
    mo = meshes[0]
    for extra in meshes[1:]:
        bpy.data.objects.remove(extra, do_unlink=True)
    for mod in mo.modifiers:
        if mod.type == "ARMATURE":
            mod.object = arm
    merge_groups(mo, arm)
    select([mo])
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    select([arm, mo], arm)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if ground is None:
        ground = -min(v.co.z for v in mo.data.vertices)
    for o in (arm, mo):
        o.location.z += ground
    select([arm, mo], arm)
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    # кости: переподчинить, лишние — вон, имена гуманоида
    select([arm])
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    for b in BIP:
        eb[b[0]].use_connect = False
    for b in BIP:
        eb[b[0]].parent = eb[C2B[b[2]]] if b[2] else None
    for e in list(eb):
        if e.name not in KEEP:
            eb.remove(e)
    bpy.ops.object.mode_set(mode="OBJECT")
    for b in BIP:
        arm.data.bones[b[0]].name = b[1]
    arm.name = "Skeleton"
    arm.data.name = "Skeleton"
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
    arm.data.pose_position = "POSE"                     # иначе экспортёр выпекает клипы в позе покоя
    select([mo, arm], arm)
    bpy.ops.object.parent_set(type="OBJECT", keep_transform=True)
    return arm, mo, ground


def smooth(mo):
    me = mo.data
    for p in me.polygons:
        p.use_smooth = True
    select([mo])
    try:
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    except RuntimeError:
        pass
    for name in [a.name for a in me.color_attributes]:
        me.color_attributes.remove(me.color_attributes[name])


def drop_hair(o):
    """Карточки волос — по области атласа (материал уже один)."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    uv = bm.loops.layers.uv.active
    u0, v0, su, sv = REGION["opacity"]
    faces = []
    for f in bm.faces:
        cu = sum(lp[uv].uv[0] for lp in f.loops) / len(f.loops)
        cv = sum(lp[uv].uv[1] for lp in f.loops) / len(f.loops)
        if u0 <= cu <= u0 + su and v0 <= cv <= v0 + sv:
            faces.append(f)
    if faces:
        bmesh.ops.delete(bm, geom=faces, context="FACES")
    bm.to_mesh(o.data)
    bm.free()


def make_lod(mo, ratio, name, no_hair=False):
    o = mo.copy()
    o.data = mo.data.copy()
    o.name = o.data.name = name
    bpy.context.collection.objects.link(o)
    if no_hair:
        drop_hair(o)
    if ratio < 0.999:
        mod = o.modifiers.new("dec", "DECIMATE")
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        select([o])
        bpy.ops.object.modifier_move_to_index(modifier="dec", index=0)
        bpy.ops.object.modifier_apply(modifier="dec")
    return o


def tri_count(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def export_glb(path, objs, anims=False):
    select(objs)
    kw = dict(filepath=path, export_format="GLB", use_selection=True, export_skins=True, export_animations=anims,
              export_materials="NONE", export_texcoords=True, export_normals=True, export_yup=True,
              export_morph=False, export_extras=False, export_def_bones=False, export_leaf_bone=False,
              export_influence_nb=4, export_rest_position_armature=True, export_vertex_color="NONE",
              export_attributes=False, export_tangents=False)
    if anims:
        kw.update(export_animation_mode="NLA_TRACKS", export_force_sampling=True, export_anim_slide_to_zero=True,
                  export_optimize_animation_size=True, export_reset_pose_bones=True, export_bake_animation=False)
    bpy.ops.export_scene.gltf(**kw)


def avatar_files(v):
    d = os.path.join(DL, "rb", "av", os.path.basename(v["src"]))
    fs = os.listdir(d)

    def find(part):
        hit = [f for f in fs if part in f and f.endswith(".tga")]
        return os.path.join(d, hit[0]) if hit else None
    tex = {"body": os.path.join(d, v["body"] + ".tga") if v.get("body") else find("_body_color"),
           "head": find("_head_color"), "opacity": find("_opacity_color"),
           "equip": find("_equipment_color") or find("_hat_color")}
    return os.path.join(d, os.path.basename(v["src"]) + ".fbx"), {k: p for k, p in tex.items() if p}


def build_avatar(v, ground):
    fbx, tex = avatar_files(v)
    reset()
    arm, mo, g = prepare(fbx, ground)
    drop_faces(mo, lambda k: k == "pistol")
    tris = body_tris(mo)
    kinds = to_atlas(mo)
    smooth(mo)
    mo.name = "src"
    lods = [make_lod(mo, r, "lod%d" % i, no_hair=(i == 2)) for i, r in enumerate(CFG["lod"])]
    bpy.data.objects.remove(mo, do_unlink=True)
    for o in lods:
        o.parent = arm
    height = max(v2.co.z for v2 in lods[0].data.vertices)
    export_glb(os.path.join(OUT, v["id"] + ".glb"), [arm] + lods)
    meta = {"id": v["id"], "tex": {k: tex[k] for k in tex if k in kinds or k == "body"}, "tris": tris,
            "patch": v.get("patch", []), "tint": v.get("tint", 0)}
    json.dump(meta, open(os.path.join(OUT, v["id"] + ".uv.json"), "w"))
    log(v["id"], "треугольники LOD", [tri_count(o) for o in lods], "рост %.2f" % height, "атлас", kinds)
    return g, {"id": v["id"], "g": v["g"], "role": v["role"], "tint": v.get("tint", 0), "old": v.get("old", 0),
               "h": round(height, 3), "tris": [tri_count(o) for o in lods]}


# ---- анимации --------------------------------------------------------------------------------------------------

def qnorm(m):
    return m.to_3x3().normalized().to_quaternion()


def rest_data(arm):
    """Покой цели: мировые матрицы костей и смещения детей в системе родителя (по чистой иерархии и по Biped)."""
    R = {n: arm.data.bones[n].matrix_local.copy() for n in CLEAN}
    off = {}
    for n in CLEAN:
        for par in (CPAR[n], BPAR[n]):
            if par:
                off[(n, par)] = R[par].inverted() @ R[n].translation
    return R, off


def fk(rot, hips, R, off, parents):
    """Мировые повороты + позиция таза → мировые матрицы по смещениям покоя цели."""
    W = {}
    for n in CLEAN:
        p = parents[n]
        if p is None:
            pos = hips
        else:
            Wp = W[p]
            pos = Wp.translation + Wp.to_3x3() @ off[(n, p)]
        m = rot[n].to_matrix().to_4x4()
        m.translation = pos
        W[n] = m
    return W


def basis_frames(W_frames, R):
    """Мировые матрицы → значения каналов (как у pose_bone.matrix_basis) по чистой иерархии."""
    out = []
    for W in W_frames:
        fr = {}
        for n in CLEAN:
            p = CPAR[n]
            if p is None:
                B = R[n].inverted() @ W[n]
            else:
                B = (R[p].inverted() @ R[n]).inverted() @ W[p].inverted() @ W[n]
            loc, q, _ = B.decompose()
            fr[n] = (loc, q.normalized())
        out.append(fr)
    for n in CLEAN:                                        # непрерывность знака кватерниона
        for i in range(1, len(out)):
            l, q = out[i][n]
            if q.dot(out[i - 1][n][1]) < 0:
                out[i][n] = (l, -q)
    return out


def close_loop(fr):
    """Разнести невязку конца и начала по клипу: последний кадр = первому."""
    n = len(fr) - 1
    if n < 2:
        return fr
    for b in CLEAN:
        l0, q0 = fr[0][b]
        lN, qN = fr[n][b]
        if qN.dot(q0) < 0:
            qN = -qN
        d = q0 @ qN.inverted()
        dl = l0 - lN
        for i in range(n + 1):
            t = i / n
            l, q = fr[i][b]
            fr[i][b] = (l + dl * t, (Quaternion().slerp(d, t) @ q).normalized())
    return fr


def write_action(arm, name, fr):
    """Клип → действие Blender ключами по кадрам (штатный путь: экспортёр glTF понимает его слоты)."""
    if arm.animation_data is None:
        arm.animation_data_create()
    arm.animation_data.action = None
    for i, f in enumerate(fr):
        for b in CLEAN:
            pb = arm.pose.bones[b]
            loc, q = f[b]
            pb.rotation_quaternion = q
            pb.keyframe_insert("rotation_quaternion", frame=i, group=b)
            if CPAR[b] is None:
                pb.location = loc
                pb.keyframe_insert("location", frame=i, group=b)
    act = arm.animation_data.action
    act.name = name
    act.use_fake_user = True
    slot = arm.animation_data.action_slot
    # экспортёр glTF берёт клипы с дорожек NLA: одна дорожка = одна анимация с именем дорожки
    tr = arm.animation_data.nla_tracks.new()
    tr.name = name
    st = tr.strips.new(name, 0, act)
    if slot is not None:
        st.action_slot = slot
    tr.mute = True
    arm.animation_data.action = None
    return act


def sample_source(arm, names, f0, f1, step, reverse=False):
    """Мировые матрицы костей источника по кадрам (дробные кадры — subframe)."""
    sc = bpy.context.scene
    out = []
    n = int(math.floor((f1 - f0) / step + 1e-6)) + 1
    for i in range(n):
        f = (f1 - i * step) if reverse else (f0 + i * step)
        fi = int(math.floor(f))
        sc.frame_set(fi, subframe=f - fi)
        out.append({k: arm.matrix_world @ arm.pose.bones[v].matrix for k, v in names.items()})
    return out


def feat(frames, parents):
    """Признак позы кадра: локальные повороты костей (не зависят от покоя) → массив (кадры, кости, 4)."""
    F = np.zeros((len(frames), len(CLEAN), 4))
    for i, M in enumerate(frames):
        for j, n in enumerate(CLEAN):
            q = qnorm(M[n])
            p = parents[n]
            if p:
                q = qnorm(M[p]).inverted() @ q
            F[i, j] = (q.w, q.x, q.y, q.z)
    return F


def best_window(F, lmin, lmax, gait):
    """Окно [a, a+L] с самым похожим началом и концом (позы и скорость позы)."""
    n = len(F)
    D = np.zeros((n, n))
    for b in range(F.shape[1]):
        D += 1 - np.abs(F[:, b, :] @ F[:, b, :].T)
    best, ba, bl = 1e9, 0, n - 1
    lmax = min(lmax, n - 2)
    for L in range(max(lmin, 4), lmax + 1):
        for a in range(0, n - L - 1):
            c = D[a, a + L] + D[a + 1, a + L + 1] - (0.02 if gait else 0.004) * L / lmax
            if c < best:
                best, ba, bl = c, a, L
    return ba, bl, best


def stance_speed(W_frames, fps):
    """Скорость шага по опорной ноге: она едет назад относительно таза со скоростью земли."""
    vs = []
    zmin = min(min(W["LeftToeBase"].translation.z, W["RightToeBase"].translation.z) for W in W_frames)
    for i in range(1, len(W_frames)):
        a, b = W_frames[i - 1], W_frames[i]
        lf = "LeftToeBase" if a["LeftToeBase"].translation.z < a["RightToeBase"].translation.z else "RightToeBase"
        if a[lf].translation.z > zmin + 0.04:
            continue
        dy = (b[lf].translation.y - b["Hips"].translation.y) - (a[lf].translation.y - a["Hips"].translation.y)
        vs.append(dy * fps)
    vs.sort()
    return abs(vs[len(vs) // 2]) if vs else 0.0


def anim_clip(T, R, off, spec, g, ual):
    """Один клип на скелет пола g → кадры каналов, длительность, скорость."""
    src = spec["src"]
    kind, name = src.split(":", 1)
    sc = bpy.context.scene
    speed_mul = spec.get("speed", 1.0)
    if kind == "pose":
        return pose_clip(T, R, off, name)
    if kind == "rb":
        before = set(bpy.data.objects)
        S, _ = import_fbx(os.path.join(DL, "rb", "anim", "%s_%s.max.fbx" % (g, name)))
        for o in set(bpy.data.objects) - before:
            if o.type == "MESH":
                bpy.data.objects.remove(o, do_unlink=True)
        act = S.animation_data.action
        f0, f1 = act.frame_range
        names = {c: C2B[c] for c in CLEAN}
        rest_h = (S.matrix_world @ S.data.bones["Bip01 Pelvis"].matrix_local).translation.z
        log("   таз: покой источника %.3f, цели %.3f" % (rest_h, R["Hips"].translation.z))
        raw = sample_source(S, names, f0, f1, 1.0)
        parents = BPAR
    else:
        S = ual["arm"]
        act = bpy.data.actions[name]
        S.animation_data.action = act
        S.animation_data.action_slot = act.slots[0]
        f0, f1 = act.frame_range
        raw = sample_source(S, UAL, f0, f1, speed_mul, reverse=bool(spec.get("reverse")))
        parents = CPAR
    # окно петли
    n = len(raw)
    a, L = 0, n - 1
    if spec.get("loop") and kind == "rb":
        F = feat(raw, parents)
        if spec.get("gait"):
            a, L, cost = best_window(F, int(0.5 * FPS), n - 2, True)
        else:
            lo, hi = spec.get("len", [2, 6])
            a, L, cost = best_window(F, int(lo * FPS), int(hi * FPS), False)
        log("   окно", spec["id"], "кадры", a, "+", L, "из", n, "невязка %.3f" % cost)
    elif kind == "rb" and n - 1 > spec.get("max", 4.0) * FPS:
        # разовый жест длиннее предела: самое «живое» окно (наибольшая скорость позы)
        F = feat(raw, parents)
        e = (1 - np.abs((F[1:] * F[:-1]).sum(axis=2))).sum(axis=1)
        L = int(spec.get("max", 4.0) * FPS)
        cs = np.concatenate([[0], np.cumsum(e)])
        a = int(np.argmax(cs[L:] - cs[:-L])) if len(cs) > L else 0
        log("   окно", spec["id"], "кадры", a, "+", L, "из", n, "(самое живое)")
    raw = raw[a:a + L + 1]
    # повороты и таз в мире цели
    rot_frames, hips = [], []
    if kind == "rb":
        for M in raw:
            rot_frames.append({c: qnorm(M[c]) for c in CLEAN})
            hips.append(M["Hips"].translation.copy())
    else:
        al = ual["align"]
        for M in raw:
            rot_frames.append({c: (qnorm(M[c]) @ al[c]).normalized() for c in CLEAN})
            hips.append(ual["h0t"] + (M["Hips"].translation - ual["h0s"]) * ual["k"])
    speed = 0.0
    if spec.get("gait") and kind == "rb":
        d = hips[-1] - hips[0]
        d.z = 0
        dur = (len(hips) - 1) / FPS
        speed = d.length / dur
        # направление хода → строго вперёд (−Y), смещение убрать: шаг на месте
        ang = math.atan2(d.x, -d.y) if d.length > 1e-4 else 0.0
        rz = Quaternion((0, 0, 1), ang)
        h0 = hips[0].copy()
        for i in range(len(hips)):
            t = i / max(1, len(hips) - 1)
            p = hips[i] - h0 - d * t
            p = rz @ p
            hips[i] = Vector((p.x, p.y, hips[i].z))
            rot_frames[i] = {c: (rz @ q).normalized() for c, q in rot_frames[i].items()}
    elif kind == "rb":
        h0 = hips[0].copy()
        for i in range(len(hips)):
            hips[i] = Vector((hips[i].x - h0.x, hips[i].y - h0.y, hips[i].z))
    W_frames = [fk(rot_frames[i], hips[i], R, off, parents if kind == "rb" else CPAR) for i in range(len(hips))]
    if spec.get("gait") and kind == "ual":
        speed = stance_speed(W_frames, FPS)
    fr = basis_frames(W_frames, R)
    if spec.get("loop"):
        fr = close_loop(fr)
    if kind == "rb":
        bpy.data.objects.remove(S, do_unlink=True)
        bpy.data.actions.remove(act)
    return fr, speed


def pose_clip(T, R, off, name):
    """«Руки вверх»: плечи в стороны, предплечья вверх; дыхание и дрожь рук, петля 2 с."""
    n = 2 * FPS
    base = {c: qnorm(R[c]) for c in CLEAN}
    hips0 = R["Hips"].translation.copy()
    W0 = fk(base, hips0, R, off, CPAR)

    def aim(bone, child, want, rot):
        d = (W0[child].translation - W0[bone].translation).normalized()
        return (d.rotation_difference(want.normalized()) @ rot[bone]).normalized()
    frames = []
    for i in range(n + 1):
        t = i / n * 2 * math.pi
        rot = dict(base)
        sway = Quaternion((1, 0, 0), 0.025 * math.sin(t))
        for c in ("Spine", "Spine1", "Spine2"):
            rot[c] = (sway @ rot[c]).normalized()
        for side, sx in (("Left", 1), ("Right", -1)):
            tr = 0.04 * math.sin(t * 3 + sx)
            ua = Vector((sx * 1.0, -0.15, 0.25 + tr))
            fa = Vector((sx * 0.12, -0.12, 1.0))
            rot[side + "Arm"] = aim(side + "Arm", side + "ForeArm", ua, base)
            Wt = fk(rot, hips0, R, off, CPAR)
            d = (Wt[side + "Hand"].translation - Wt[side + "ForeArm"].translation).normalized()
            rot[side + "ForeArm"] = (d.rotation_difference(fa.normalized()) @ Wt[side + "ForeArm"].to_quaternion()).normalized()
            rot[side + "Hand"] = (d.rotation_difference(fa.normalized()) @ Wt[side + "Hand"].to_quaternion()).normalized()
        hips = hips0 + Vector((0, 0, 0.006 * math.sin(t)))
        frames.append(fk(rot, hips, R, off, CPAR))
    return close_loop(basis_frames(frames, R)), 0.0


def ual_setup(T, R):
    """Quaternius UAL1: импорт GLB, подгонка покоя Rigify к покою Biped по направлениям костей."""
    path = None
    for root, _, files in os.walk(os.path.join(DL, "ual1")):
        for f in files:
            if f == "AnimationLibrary_Godot_Standard.glb":
                path = os.path.join(root, f)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = set(bpy.data.objects) - before
    S = next(o for o in new if o.type == "ARMATURE")
    for o in new:
        if o.type != "ARMATURE":
            bpy.data.objects.remove(o, do_unlink=True)
    if S.animation_data is None:
        S.animation_data_create()
    for tr in list(S.animation_data.nla_tracks):
        S.animation_data.nla_tracks.remove(tr)
    S.animation_data.action = None
    for pb in S.pose.bones:
        pb.matrix_basis = Matrix()
    bpy.context.view_layer.update()
    Rs = {c: S.matrix_world @ S.data.bones[UAL[c]].matrix_local for c in CLEAN}
    align = {}
    for c in CLEAN:                                       # повороты: Qt = Qs · Qs_rest⁻¹ · A⁻¹ · Qt_rest
        ch = DIRCHILD.get(c)
        if ch:
            ds = (Rs[ch].translation - Rs[c].translation).normalized()
            dt = (R[ch].translation - R[c].translation).normalized()
            A = ds.rotation_difference(dt)
        else:
            A = align[CPAR[c]][1]
        align[c] = (qnorm(Rs[c]).inverted() @ A.inverted() @ qnorm(R[c]), A)
    al = {c: align[c][0] for c in CLEAN}
    h0s, h0t = Rs["Hips"].translation.copy(), R["Hips"].translation.copy()
    k = h0t.z / max(h0s.z, 1e-3)
    log("UAL1: таз", round(h0s.z, 3), "→", round(h0t.z, 3), "клипов", len(bpy.data.actions))
    return {"arm": S, "align": al, "h0s": h0s, "h0t": h0t, "k": k}


def build_anims(g, ground):
    base = CFG["base"][g]
    v = next(x for x in CFG["variants"] if x["src"].endswith("/" + base))
    fbx, _ = avatar_files(v)
    reset()
    T, mo, _ = prepare(fbx, ground)
    # носитель скелета — один треугольник на тазе (экспортёру нужен скин, чтобы выгрузить кости)
    bpy.data.objects.remove(mo, do_unlink=True)
    me = bpy.data.meshes.new("carrier")
    me.from_pydata([(0, 0, 0.9), (0.01, 0, 0.9), (0, 0.01, 0.9)], [], [(0, 1, 2)])
    car = bpy.data.objects.new("carrier", me)
    bpy.context.collection.objects.link(car)
    car.vertex_groups.new(name="Hips").add([0, 1, 2], 1.0, "REPLACE")
    car.modifiers.new("arm", "ARMATURE").object = T
    car.parent = T
    R, off = rest_data(T)
    ual = ual_setup(T, R)
    clips = []
    for spec in CFG["clips"]:
        if CLIPS and spec["id"] not in CLIPS:
            continue
        fr, speed = anim_clip(T, R, off, spec, g, ual)
        write_action(T, spec["id"], fr)
        if OPT.get("debug"):
            bpy.context.scene.frame_set(min(5, len(fr) - 1))
            log("   отладка", spec["id"], tuple(round(x, 3) for x in T.pose.bones["LeftUpLeg"].rotation_quaternion),
                tuple(round(x, 3) for x in fr[min(5, len(fr) - 1)]["LeftUpLeg"][1]))
        dur = (len(fr) - 1) / FPS
        clips.append({"id": spec["id"], "loop": spec.get("loop", 0), "dur": round(dur, 3), "speed": round(speed, 3)})
        log("  клип", g, spec["id"], "%.2f с" % dur, "скорость %.2f м/с" % speed if speed else "")
    bpy.data.objects.remove(ual["arm"], do_unlink=True)
    for a in list(bpy.data.actions):
        if a.name not in {c["id"] for c in clips}:
            bpy.data.actions.remove(a)
    T.animation_data.action = None
    for tr in T.animation_data.nla_tracks:
        tr.mute = False
    export_glb(os.path.join(OUT, "anims_%s.glb" % g), [T, car], anims=True)
    return clips


def main():
    meta_path = os.path.join(OUT, "build.json")
    meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {}
    ground = meta.get("ground", {})
    variants = {x["id"]: x for x in meta.get("variants", [])}
    # базовые аватары первыми: их ступни задают «ноль» скелета пола
    order = sorted(CFG["variants"], key=lambda x: 0 if x["src"].endswith("/" + CFG["base"][x["g"]]) else 1)
    for v in order:
        if v["g"] not in ground:
            reset()
            _, _, gr = prepare(avatar_files(v)[0])
            ground[v["g"]] = gr
            log("ноль скелета", v["g"], round(gr, 4))
        if ONLY and v["id"] not in ONLY:
            continue
        _, info = build_avatar(v, ground[v["g"]])
        variants[v["id"]] = info
    clips = meta.get("clips", {})
    for g in GENDERS:
        if ONLY and "anims" not in ONLY and not CLIPS:
            continue
        got = build_anims(g, ground[g])
        old = {c["id"]: c for c in clips.get(g, [])}
        old.update({c["id"]: c for c in got})
        clips[g] = [old[c["id"]] for c in CFG["clips"] if c["id"] in old]
    meta = {"ground": ground, "variants": [variants[v["id"]] for v in CFG["variants"] if v["id"] in variants],
            "clips": clips}
    json.dump(meta, open(meta_path, "w"), ensure_ascii=False, indent=1)
    log("готово:", meta_path)


main()
