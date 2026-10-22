"""
Animation clips on the shared rig, keyed from a few poses each and baked
into every character's .glb as named glTF animations:

    idle         standing, breathing, glancing around        (loop, 3 s)
    walk         walk cycle in place; move the root yourself  (loop, 1 s)
    seated_idle  on a 0.45 m seat, hands on thighs            (loop, 4 s)
    stand_up     seated_idle to idle                          (1.5 s)
    typing       seated, hands on a desk at 0.74 m            (loop, 2 s)
    point        standing, points at something ahead          (2 s)
    step_down    two 0.5 m steps down and 0.6 m forward, as out
                 of a helicopter cabin; ends with the hips 1 m lower,
                 so move the root there when it finishes      (1.75 s)

Face clips move only the eye and brow bones, so they play on top of any
body clip (body clips never touch the face bones):

    blink        eyes squash shut and open                    (0.3 s)
    brows_raise  surprised: brows up, eyes a little wider     (1.5 s)
    brows_frown  brows down and in, eyes narrowed             (1.5 s)

A pose is {bone: rotation} with the rotation as (axis, degrees) or a list
of them applied in order, axes in the rest pose's armature space (see
base_body.pose). "hips_offset" moves the hips (and everything on them)
by a world-space vector. Clips loop by repeating their first pose.
"""
import json
import math
import struct

import bpy
from mathutils import Matrix, Vector

import base_body as base

FPS = 24
X, Y, Z = base.X, base.Y, base.Z
DOWN = Vector((0, 0, -1))
SEAT_DROP = -0.39      # hips drop that puts the thighs on a 0.45 m seat pan


def _arm(side):
    return base.arm_dir(side)


def _tag(side):
    return "R" if side == 1 else "L"


def arms_down(r, lower=36, swing=(0, 0), elbow=(12, 12)):
    """Arms lowered from the A-pose to hang by the sides, swung forward by
    swing[R], swing[L] degrees, elbows bent by elbow[R], elbow[L]."""
    for i, side in enumerate((1, -1)):
        d = _arm(side)
        r[f"upper_arm.{_tag(side)}"] = [(base.bend(d, DOWN), lower), (X, swing[i])]
        r[f"forearm.{_tag(side)}"] = (base.bend(d, Y), elbow[i])
    return r


def legs(r, tag, thigh, shin, foot=0.0):
    """Hip flexion forward, knee bend back, and the foot kept level plus
    `foot` degrees (negative points the toes down)."""
    r[f"thigh.{tag}"] = (X, thigh)
    r[f"shin.{tag}"] = (-X, shin)
    r[f"foot.{tag}"] = (X, shin - thigh + foot)
    return r


# ------------------------------------------------------------------ poses
def standing(breath=0.0, head=0.0, sway=0.0):
    r = arms_down({}, swing=(2, 2))
    r["chest"] = (X, breath)
    r["head"] = [(Z, head), (X, -breath)]
    r["hips"] = (Y, sway)
    r["spine"] = (Y, -sway)
    r["hips_offset"] = (0.0, 0.0, 0.0)
    return r


def seated(breath=0.0, head=0.0, look_down=0.0):
    """Sitting upright on a seat, back reclined a little, hands resting on
    the thighs."""
    r = {}
    for side in (1, -1):
        legs(r, _tag(side), 88, 84)
        lap_hands(r, side, lean=8)
    r["spine"] = (X, 6)
    r["chest"] = (X, 2 + breath)
    r["neck"] = (X, -5)
    r["head"] = [(Z, head), (X, -3 - breath - look_down)]
    r["hips_offset"] = (0.0, -0.02, SEAT_DROP)
    return r


def aim(r, chain, parent=Matrix.Identity(3)):
    """Point a chain of bones (rest direction along the arm) at world
    directions: chain is [(bone, rest_dir, world_dir)], parent the world
    rotation of the first bone's parent. Each rotation is the shortest
    turn, so the bones keep their rest twist."""
    world = parent
    for bone, d0, d1 in chain:
        local = world.inverted() @ Vector(d1).normalized()
        q = Vector(d0).normalized().rotation_difference(local)
        r[bone] = q
        world = world @ q.to_matrix()
    return r


def lap_hands(r, side, lean=0.0):
    """Arms hanging relaxed with the hands resting in the lap, for a seated
    pose whose chest leans back `lean` degrees."""
    d, tag = _arm(side), _tag(side)
    aim(r, [(f"upper_arm.{tag}", d, (side * 0.02, 0.22, -1.0)),
            (f"forearm.{tag}", d, (-side * 0.40, 0.80, -0.45)),
            (f"hand.{tag}", d, (-side * 0.30, 0.90, -0.30))],
        Matrix.Rotation(math.radians(lean), 3, X))
    return r


def typing(phase):
    """Seated, leaning in, forearms level over a desk, hands patting."""
    r = seated(look_down=10)
    r["spine"] = (X, -4)
    r["chest"] = (X, -2)
    for i, side in enumerate((1, -1)):
        d = _arm(side)
        tap = 4 * math.sin(2 * math.pi * (phase * 3 + i * 0.37))
        r[f"upper_arm.{_tag(side)}"] = [(base.bend(d, DOWN), 38), (X, 30), (Z, -side * 8)]
        r[f"forearm.{_tag(side)}"] = [(base.bend(d, Y), 85 + tap), (Z, -side * 12)]
        r[f"hand.{_tag(side)}"] = (X, -10 - tap)
    return r


def walk_pose(t):
    """Walk cycle at phase t (0..1), right heel strike at 0."""
    keys = [(0.0, 24, 4, 0), (0.125, 17, 14, 0), (0.25, 5, 6, 0), (0.375, -8, 5, 0),
            (0.5, -16, 16, -12), (0.625, -6, 48, -22), (0.75, 14, 58, -6), (0.875, 26, 22, 0), (1.0, 24, 4, 0)]

    def leg(p):
        p %= 1.0
        for (t0, *a), (t1, *b) in zip(keys, keys[1:]):
            if t0 <= p <= t1:
                f = (p - t0) / (t1 - t0)
                return [x + (y - x) * f for x, y in zip(a, b)]
    r = {}
    legs(r, "R", *leg(t))
    legs(r, "L", *leg(t + 0.5))
    swing = 18 * math.cos(2 * math.pi * t)
    arms_down(r, lower=38, swing=(-swing, swing), elbow=(14 + max(0, -swing) * 0.6, 14 + max(0, swing) * 0.6))
    twist = 5 * math.cos(2 * math.pi * t)
    r["hips"] = (Z, twist)
    r["spine"] = [(Z, -twist * 0.6), (X, -3)]
    r["chest"] = (Z, -twist * 0.7)
    r["head"] = (Z, twist * 0.3)
    r["hips_offset"] = (0.0, 0.0, -0.018 - 0.014 * math.cos(4 * math.pi * (t - 0.08)))
    return r


def pointing(f):
    """Standing; f = 0 rest, 1 right arm fully raised pointing ahead."""
    r = standing()
    d = _arm(1)
    r["upper_arm.R"] = [(base.bend(d, DOWN), 36 * (1 - f)), (base.bend(d, Y), 80 * f)]
    r["forearm.R"] = (base.bend(d, Y), 12 * (1 - f) + 4 * f)
    r["chest"] = (Z, 10 * f)
    r["head"] = (Z, 12 * f)
    return r


def clips():
    """{name: [(frame, pose)]}."""
    c = {}
    c["idle"] = [(0, standing()), (18, standing(breath=1.5, head=-8, sway=1)), (36, standing(head=-8, sway=1.5)),
                 (54, standing(breath=1.5, head=6, sway=0.5)), (72, standing())]
    c["walk"] = [(k * 3, walk_pose(k / 8)) for k in range(9)]
    c["seated_idle"] = [(0, seated()), (24, seated(breath=1.2, head=12)), (48, seated(head=12)),
                        (72, seated(breath=1.2, head=-15)), (96, seated())]
    up = standing()
    lean = seated()
    lean["spine"] = (X, -34)
    lean["neck"] = (X, 12)
    lean["head"] = (X, 10)
    lean["hips_offset"] = (0.0, 0.08, SEAT_DROP + 0.02)
    rise = {**up, "spine": (X, -16), "neck": (X, 6)}
    for side in (1, -1):
        legs(rise, _tag(side), 40, 50)
    rise["hips_offset"] = (0.0, 0.05, -0.18)
    c["stand_up"] = [(0, seated()), (12, lean), (24, rise), (36, up)]
    c["typing"] = [(k * 6, typing(k / 8)) for k in range(9)]
    c["point"] = [(0, pointing(0)), (10, pointing(1)), (36, pointing(1)), (48, pointing(0))]
    c["step_down"] = stepping_down()
    return c


def stepping_down(rise=0.5, run=0.3):
    """Two steps down, right foot first: reach down with the leading leg
    while the other knee bends, land, then bring the feet together."""
    keys = [(0, standing())]
    for k, (lead, back) in enumerate((("R", "L"), ("L", "R"))):
        y0, z0, f0 = run * k, -rise * k, 21 * k
        reach = arms_down(standing(), lower=30, swing=(12, 12), elbow=(25, 25))
        legs(reach, lead, 34, 12, -14)
        legs(reach, back, 42, 72)
        reach["spine"] = (X, -8)
        reach["hips_offset"] = (0.0, y0 + 0.12, z0 - 0.24)
        land = arms_down(standing(), lower=32, swing=(6, 6), elbow=(18, 18))
        legs(land, lead, 12, 18)
        legs(land, back, -10, 46)
        land["spine"] = (X, -5)
        land["hips_offset"] = (0.0, y0 + 0.24, z0 - rise - 0.02)
        stand = standing()
        stand["hips_offset"] = (0.0, y0 + run, z0 - rise)
        keys += [(f0 + 8, reach), (f0 + 14, land), (f0 + 21, stand)]
    return keys


def face(brow_up=0.0, brow_tilt=0.0, eye_open=1.0):
    """Face pose: brows moved up (metres, negative down) and tilted with the
    inner ends down (degrees), eyes scaled in height (1 open, ~0.1 shut)."""
    r = {}
    for s, tag in ((1, "R"), (-1, "L")):
        r[f"brow.{tag}"] = {"loc": (0, 0, brow_up), "rot": (Y, -s * brow_tilt)}
        r[f"eye.{tag}"] = {"scale": eye_open}
    return r


def face_clips():
    rest = face()
    return {"blink": [(0, rest), (2, face(eye_open=0.1)), (4, face(eye_open=0.1)), (7, rest)],
            "brows_raise": [(0, rest), (5, face(0.009, 0, 1.15)), (30, face(0.009, 0, 1.15)), (36, rest)],
            "brows_frown": [(0, rest), (5, face(-0.004, 14, 0.75)), (30, face(-0.004, 14, 0.75)), (36, rest)]}


# ------------------------------------------------------------------ keying
def _rotation(arm_ob, bone, spec):
    if hasattr(spec, "to_matrix"):  # a quaternion from aim()
        m = arm_ob.data.bones[bone].matrix_local.to_3x3()
        return (m.inverted() @ spec.to_matrix() @ m).to_quaternion()
    if isinstance(spec, tuple):
        spec = [spec]
    r = Matrix.Identity(3)
    for axis, deg in spec:
        r = Matrix.Rotation(math.radians(deg), 3, Vector(axis)) @ r
    m = arm_ob.data.bones[bone].matrix_local.to_3x3()
    return (m.inverted() @ r @ m).to_quaternion()


def apply(arm_ob, pose):
    for pb in arm_ob.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    for bone, spec in pose.items():
        if bone == "hips_offset":
            m = arm_ob.data.bones["hips"].matrix_local.to_3x3()
            arm_ob.pose.bones["hips"].location = m.inverted() @ Vector(spec)
        else:
            arm_ob.pose.bones[bone].rotation_quaternion = _rotation(arm_ob, bone, spec)


def apply_face(arm_ob, pose):
    for bn in base.FACE_BONES:
        pb = arm_ob.pose.bones[bn]
        pb.rotation_mode = "QUATERNION"
        spec = pose.get(bn, {})
        m = arm_ob.data.bones[bn].matrix_local.to_3x3()
        pb.location = m.inverted() @ Vector(spec.get("loc", (0, 0, 0)))
        pb.rotation_quaternion = _rotation(arm_ob, bn, spec["rot"]) if "rot" in spec else (1, 0, 0, 0)
        pb.scale = (1, spec.get("scale", 1.0), 1)   # local Y is up


def _track(ad, name, act):
    slot = ad.action_slot
    ad.action = None
    track = ad.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, 0, act)
    if slot is not None and hasattr(strip, "action_slot"):
        strip.action_slot = slot
    track.mute = True


def add_clips(arm_ob):
    """Key every clip as its own action, each on a muted NLA track so the
    glTF exporter writes one animation per clip. Leaves the rest pose."""
    bpy.context.scene.render.fps = FPS
    ad = arm_ob.animation_data_create()
    for name, keys in clips().items():
        act = bpy.data.actions.new(name)
        ad.action = act
        for frame, pose in keys:
            apply(arm_ob, pose)
            for pb in arm_ob.pose.bones:
                if pb.name not in base.FACE_BONES:
                    pb.keyframe_insert("rotation_quaternion", frame=frame, group=pb.name)
            arm_ob.pose.bones["hips"].keyframe_insert("location", frame=frame, group="hips")
        _track(ad, name, act)
    for name, keys in face_clips().items():
        act = bpy.data.actions.new(name)
        ad.action = act
        for frame, pose in keys:
            apply_face(arm_ob, pose)
            for bn in base.FACE_BONES:
                for path in ("location", "rotation_quaternion", "scale"):
                    arm_ob.pose.bones[bn].keyframe_insert(path, frame=frame, group=bn)
        _track(ad, name, act)
    apply(arm_ob, {})
    apply_face(arm_ob, {})
    bpy.context.view_layer.update()


def split_channels(glb_path):
    """The exporter samples every bone into every clip. Strip the face bones
    out of body clips and everything but the face bones out of face clips,
    so a blink can play on top of a walk without freezing the body."""
    with open(glb_path, "rb") as f:
        data = f.read()
    n = struct.unpack("<I", data[12:16])[0]
    gltf = json.loads(data[20:20 + n])
    rest = data[20 + n:]
    nodes = gltf["nodes"]
    face_clips_ = set(face_clips())
    for anim in gltf.get("animations", []):
        on_face = anim["name"] in face_clips_
        anim["channels"] = [c for c in anim["channels"]
                            if (nodes[c["target"]["node"]].get("name") in base.FACE_BONES) == on_face]
        used = sorted({c["sampler"] for c in anim["channels"]})
        remap = {old: new for new, old in enumerate(used)}
        anim["samplers"] = [anim["samplers"][i] for i in used]
        for c in anim["channels"]:
            c["sampler"] = remap[c["sampler"]]
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    total = 12 + 8 + len(js) + len(rest)
    with open(glb_path, "wb") as f:
        f.write(data[:8] + struct.pack("<I", total) + struct.pack("<I", len(js)) + b"JSON" + js + rest)
