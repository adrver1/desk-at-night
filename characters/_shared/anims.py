"""
Animation clips on the shared rig, keyed from a few poses each and baked
into every character's .glb as named glTF animations:

    idle         standing, breathing, glancing around        (loop, 3 s)
    walk         walk cycle in place; move the root yourself  (loop, 1 s)
    seated_idle  on a 0.45 m seat, hands on thighs            (loop, 4 s)
    stand_up     seated_idle to idle                          (1.5 s)
    typing       seated, hands on a desk at 0.74 m            (loop, 2 s)
    point        standing, points at something ahead          (2 s)

A pose is {bone: rotation} with the rotation as (axis, degrees) or a list
of them applied in order, axes in the rest pose's armature space (see
base_body.pose). "hips_offset" moves the hips (and everything on them)
by a world-space vector. Clips loop by repeating their first pose.
"""
import math

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
        d = _arm(side)
        r[f"upper_arm.{_tag(side)}"] = [(base.bend(d, DOWN), 30), (X, 14)]
        r[f"forearm.{_tag(side)}"] = (base.bend(d, Y), 42)
    r["spine"] = (X, 6)
    r["chest"] = (X, 2 + breath)
    r["neck"] = (X, -5)
    r["head"] = [(Z, head), (X, -3 - breath - look_down)]
    r["hips_offset"] = (0.0, -0.02, SEAT_DROP)
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
        lean[f"forearm.{_tag(side)}"] = (base.bend(_arm(side), Y), 55)
    rise["hips_offset"] = (0.0, 0.05, -0.18)
    c["stand_up"] = [(0, seated()), (12, lean), (24, rise), (36, up)]
    c["typing"] = [(k * 6, typing(k / 8)) for k in range(9)]
    c["point"] = [(0, pointing(0)), (10, pointing(1)), (36, pointing(1)), (48, pointing(0))]
    return c


# ------------------------------------------------------------------ keying
def _rotation(arm_ob, bone, spec):
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
                pb.keyframe_insert("rotation_quaternion", frame=frame, group=pb.name)
            arm_ob.pose.bones["hips"].keyframe_insert("location", frame=frame, group="hips")
        slot = ad.action_slot
        ad.action = None
        track = ad.nla_tracks.new()
        track.name = name
        strip = track.strips.new(name, 0, act)
        if slot is not None and hasattr(strip, "action_slot"):
            strip.action_slot = slot
        track.mute = True
    apply(arm_ob, {})
    bpy.context.view_layer.update()
