"""
Animation clips on the shared rig, keyed from a few poses each and baked
into every character's .glb as named glTF animations:

    idle         standing, breathing, glancing around        (loop, 3 s)
    walk         walk cycle in place; move the root yourself  (loop, 1 s)
    seated_idle  on a 0.45 m seat, hands on thighs            (loop, 4 s)
    stand_up     seated_idle to idle                          (1.5 s)
    typing       seated, hands on a desk at 0.74 m            (loop, 2 s)
    flying       seated as a pilot: right hand on the cyclic between
                 the knees, left on the collective grip by the left
                 thigh (0.23 m left, 0.27 m ahead, 0.52 m up), small
                 stick inputs, glancing out               (loop, 4 s)
    point        standing, points at something ahead          (2 s)
    step_down    two 0.5 m steps down and 0.6 m forward, as out
                 of a helicopter cabin; ends with the hips 1 m lower,
                 so move the root there when it finishes      (1.75 s)
    sip          seated: leans over to a mug on the desk to the
                 right (SIP_MUG), lifts it to the mouth, sips and puts
                 it back; the hand holds it from SIP_HOLD[0] to [1] s,
                 so a player moves the mug with hand.R then  (3.8 s)
    sip_left     the same with the left hand, a mug to the left
    mouse        seated: right hand onto a mouse on the desk
                 (MOUSE_AT), small wiggles, back to the lap     (4 s)
    mouse_far    the same for the second desk's mouse (MOUSE_FAR)
    phone        seated: picks a mobile up from the desk (PHONE_AT) and
                 holds it at the ear, and stays there; the hand has it
                 from PHONE_GRAB s                              (1.5 s)
    phone_down   puts it back on the desk (there from PHONE_DROP s) (1.2 s)
    phone_left, phone_left_down   the same with the left hand, for the
                 desk phone's handset (PHONE_DESK) to the left; the chair
                 is swivelled and rolled toward it by the player
    radio        seated: reaches to the desk PA mic on the right
                 (RADIO_BUTTON), keys its red talk button (RADIO_KEY s),
                 leans in to the mic (RADIO_HEAD) and stays there from
                 RADIO_TALK s while a player plays the reply (2 s)
    radio_end    sits back, lets go of the button (RADIO_OFF s)  (0.9 s)
    radio_left, radio_left_end   the same for a mic to the left
                 (RADIO_STYLE picks how; RADIO_PREVIEW=1 bakes every style)
    fart         standing: a sneaky glance round, leans forward with
                 the right knee lifted and the hip popped, a little
                 shudder, then straightens up (neutral face); the puff is
                 from 0.75 to 1.25 s (FART_PUFF)              (2.5 s)
    fart_seated  the same on a 0.45 m seat: rolls onto the left cheek,
                 shudder, settles back                        (2.5 s)
    hug          cuddles a baby sloth (or any small bundle) at the
                 chest: right forearm under its bottom, left arm
                 round its tummy, rocking side to side with the
                 cheek tilted down to it; parent the prop to the
                 chest bone at HUG_HOLD                       (loop, 4 s)

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
import os
import struct

import bpy
from mathutils import Matrix, Quaternion, Vector

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
    turn, so the bones keep their rest twist, unless an entry has a fourth
    item (rest palm direction, world palm direction): then the bone also
    rolls about itself until the palm faces as near that way as it can."""
    world = parent
    for bone, d0, d1, *palm in chain:
        local = world.inverted() @ Vector(d1).normalized()
        q = Vector(d0).normalized().rotation_difference(local)
        if palm:
            p0, p1 = palm[0]
            have = q @ Vector(p0)
            want = world.inverted() @ Vector(p1)
            have, want = (x - local * x.dot(local) for x in (have, want))
            roll = have.angle(want, 0.0)
            if have.cross(want).dot(local) < 0:
                roll = -roll
            q = Quaternion(local, roll) @ q
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
    """Seated, leaning in, elbows by the sides and forearms angled in over a
    desk, palms down on a keyboard about 0.3 m wide, fingers patting."""
    r = seated(look_down=10)
    r["spine"] = (X, -4)
    r["chest"] = (X, -2)
    for i, side in enumerate((1, -1)):
        d, tag = _arm(side), _tag(side)
        tap = 0.04 * math.sin(2 * math.pi * (phase * 3 + i * 0.37))
        palm = ((-side * 0.707, 0, -0.707), (-side * 0.25, 0, -1.0))
        aim(r, [(f"upper_arm.{tag}", d, (side * 0.06, 0.62, -0.78)),
                (f"forearm.{tag}", d, (-side * 0.40, 0.92, -0.02 + tap * 0.3), palm),
                (f"hand.{tag}", d, (-side * 0.10, 0.97, -0.12 - tap))],
            Matrix.Rotation(math.radians(-6), 3, X))
    return r


# Left arm directions (upper arm, forearm, hand), solved so the left fist sits on
# a collective grip 0.23 m left, 0.27 m ahead and 0.52 m up from the root
COLLECTIVE_ARM = ((-0.15, 0.20, -1.0), (-0.05, 0.40, -0.90), (-0.025, 0.90, -0.60))


def flying(phase):
    """Seated in a pilot's seat: right hand forward on the cyclic grip
    between the knees, left hand low by the left thigh on the collective,
    head scanning out of the windscreen."""
    r = seated(head=12 * math.sin(2 * math.pi * phase), look_down=-2)
    wob = 0.03 * math.sin(2 * math.pi * phase * 2)
    # right: elbow by the side, forearm forward and in to the grip, fist
    # round it with the palm facing in
    d = _arm(1)
    aim(r, [("upper_arm.R", d, (0.06, 0.40, -0.92)),
            ("forearm.R", d, (-0.45, 0.80 + wob, -0.40), ((-0.707, 0, -0.707), (-1.0, 0, 0.0))),
            ("hand.R", d, (-0.40, 0.90, -0.15), ((-0.707, 0, -0.707), (-1.0, 0, 0.0)))],
        Matrix.Rotation(math.radians(-6), 3, X))
    # left: arm down and forward to the collective lever by the left thigh
    d = _arm(-1)
    u, f, h = COLLECTIVE_ARM
    aim(r, [("upper_arm.L", d, u),
            ("forearm.L", d, (f[0], f[1], f[2] + wob * 0.5), ((0.707, 0, -0.707), (1.0, 0, 0.0))),
            ("hand.L", d, h, ((0.707, 0, -0.707), (1.0, 0, 0.0)))],
        Matrix.Rotation(math.radians(-6), 3, X))
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


# ------------------------------------------------- reaching from the seat
# Character space, metres, seated (hips at SEAT_DROP): the station mug and
# mouse as they stand on the control room desks from the chair
SIP_MUG = (0.52, 0.58, 0.80)          # the right hand's grip on the mug handle
MOUSE_AT = (0.40, 0.48, 0.78)         # the right wrist over the mouse
MOUSE_FAR = (0.54, 0.48, 0.78)        # the same on the second desk, whose mouse sits 14 cm further right
SIP_HOLD = (20 / FPS, 76 / FPS)       # seconds: the hand has the mug from, until
PHONE_AT = (0.14, 0.42, 0.785)        # a mobile lying on the desk edge, in front of the keyboard
PHONE_EAR = (0.12, -0.07, 1.03)       # the right wrist with the phone at the ear
PHONE_EAR_DESK = (0.15, -0.01, 1.08)  # the wrist gripping a desk handset at the ear: out from the cheek, below the ear
PHONE_DESK = (-0.36, 0.58, 0.82)       # the desk phone's handset, once the chair has turned toward it
PHONE_GRAB = 12 / FPS                 # phone: the hand has it from here on
PHONE_DROP = 16 / FPS                 # phone_down: the phone is back on the desk from here


def shoulder_seated(r, side):
    """Where the shoulder joint is in a seated pose r, from its spine and
    chest bends about X (the bones' heads at 1.0 and 1.18 m standing)."""
    def ang(bone):
        spec = r.get(bone, (X, 0))
        spec = spec if isinstance(spec, list) else [spec]
        return sum(a for ax, a in spec if ax == X)
    drop = Vector(r.get("hips_offset", (0, 0, 0)))
    spine, chest = ang("spine"), ang("chest")
    rs = Matrix.Rotation(math.radians(spine), 3, X)
    rc = Matrix.Rotation(math.radians(spine + chest), 3, X)
    s = Vector((side * base.SHOULDER.x, base.SHOULDER.y, base.SHOULDER.z))
    p = Vector((0, 0, 1.0)) + rs @ Vector((0, 0, 0.18)) + rc @ (s - Vector((0, 0, 1.18)))
    return p + drop, rc


def reach(r, side, wrist, hand_dir, palm=None, elbow_out=0.6, elbow_fwd=-0.2, shoulder=None):
    """Two-bone reach: put the side's wrist at `wrist` (character space)
    with the elbow dropped down and out, and the hand pointing along
    hand_dir; palm is the world direction the palm should face. shoulder
    finds the shoulder joint (shoulder_seated unless given)."""
    s, rc = (shoulder or shoulder_seated)(r, side)
    t = Vector(wrist)
    a, b = base.UPPER_ARM, base.FOREARM
    v = t - s
    d = min(v.length, a + b - 0.004)
    u = v.normalized()
    along = (a * a - b * b + d * d) / (2 * d)
    h = math.sqrt(max(0.0, a * a - along * along))
    pole = Vector((side * elbow_out, elbow_fwd, -1.0))
    pole = (pole - u * pole.dot(u)).normalized()
    e = s + u * along + pole * h
    d0, tag = _arm(side), _tag(side)
    rest_palm = (-side * 0.707, 0, -0.707)
    fore = [f"forearm.{tag}", d0, tuple(s + u * d - e)]
    if palm:
        fore.append((rest_palm, palm))
    aim(r, [(f"upper_arm.{tag}", d0, tuple(e - s)), tuple(fore), (f"hand.{tag}", d0, hand_dir)], rc)
    return r


def sipping(side, stage, sip=0.0):
    """Seated with a mug: stage 0 resting, 1 leaning over with the hand on
    the mug on the desk, 2 the mug at the mouth; sip tips the head back."""
    r = seated(look_down=8 * min(stage, 1.0) * (2 - max(stage, 1.0)))
    mug = Vector((side * SIP_MUG[0], SIP_MUG[1], SIP_MUG[2]))
    lean_desk = min(stage, 1.0) * (2 - max(stage, 1.0))   # 0 at rest and at the mouth, 1 at the desk
    r["spine"] = (X, 6 - 26 * lean_desk - 4 * max(0.0, stage - 1.0))
    r["chest"] = [(X, 2 - 6 * lean_desk), (Z, -side * 12 * lean_desk)]
    r["neck"] = (X, -5 + 4 * sip)
    r["head"] = [(Z, -side * 14 * lean_desk), (X, -3 - 8 * lean_desk + 14 * sip)]
    if stage <= 0:
        return r
    # the wrist by the cheek, so the cup in the hand (beside it, inside) is at the lips
    mouth = Vector((side * 0.12, 0.20, 1.12 - 0.02 * sip))
    if stage <= 1:
        lap = Vector((side * 0.20, 0.30, 0.62))
        w = lap.lerp(mug, stage)
    else:
        w = mug.lerp(mouth, stage - 1)
    # the hand reaches round the mug's handle: fingers forward and in
    up = max(0.0, stage - 1)
    reach(r, side, tuple(w + Vector((0, -0.06 * (1 - up), 0))), (-side * (0.35 - 0.1 * up), 0.9, 0.15 + 0.1 * up),
          palm=(-side, 0, 0))
    return r


def mousing(f, wiggle=(0.0, 0.0), at=MOUSE_AT):
    """Seated, f = 0 resting to 1 the right hand on the mouse, moved by
    wiggle (x, y metres); a little lean toward the desk."""
    r = seated(look_down=4 * f)
    r["spine"] = (X, 6 - 10 * f)
    r["chest"] = (X, 2 - 2 * f)
    if f <= 0:
        return r
    lap = Vector((0.20, 0.30, 0.62))
    m = Vector(at) + Vector((wiggle[0], wiggle[1], 0))
    w = lap.lerp(m, f)
    reach(r, 1, tuple(w), (-0.10, 0.97, -0.20), palm=(-0.25, 0, -1.0), elbow_out=0.9)
    return r


def sip_keys(side):
    """Reach, lift, two sips, put it back, settle (SIP_HOLD frames 20, 76)."""
    p = lambda st, sip=0.0: sipping(side, st, sip)
    return [(0, p(0)), (10, p(0.6)), (18, p(1)), (22, p(1)), (32, p(1.85)), (36, p(2)),
            (44, p(2, 1)), (50, p(2, 0.6)), (56, p(2, 1)), (62, p(2)), (70, p(1.1)), (74, p(1)),
            (78, p(1)), (86, p(0.4)), (92, p(0))]


def phoning(stage, side=1, at=PHONE_AT):
    """Seated, one hand (side 1 right, -1 left): stage 0 resting, 1 on the
    phone on the desk (at), 2 holding it at that side's ear (head tilted
    into it a little). Further out on the desk he leans further."""
    down = min(stage, 1.0) * (2 - max(stage, 1.0))   # 1 at the desk
    up = max(0.0, stage - 1.0)
    far = max(0.0, at[1] - PHONE_AT[1]) / 0.26        # 0 for the mobile in front, 1 for the desk phone
    r = seated(look_down=(6 + 6 * far) * down)
    r["spine"] = (X, 6 - (14 + 14 * far) * down)
    r["chest"] = [(X, 2 - 3 * down), (Z, -side * 10 * far * down)]
    r["head"] = [(Z, -side * 8 * up), (X, -3 - 6 * down)]
    if stage <= 0:
        return r
    phone = Vector(at)
    # a mobile lies flat in the hand against the cheek; a desk handset is gripped round its
    # handle, ear to mouth, so the hand sits further out and its fingers point forward
    desk = far > 0.5
    e = PHONE_EAR_DESK if desk else PHONE_EAR
    ear = Vector((side * e[0], e[1], e[2]))
    lap = Vector((side * 0.20, 0.30, 0.62))
    grip = phone + Vector((0, -0.07, 0.02))
    w = lap.lerp(grip, stage) if stage <= 1 else grip.lerp(ear, up)
    hand = Vector((0.0, 0.95, -0.3)).lerp(Vector((-side * 0.1, -0.05, 1.0)) if desk else Vector((-side * 0.1, 0.25, 1.0)), up)
    palm = Vector((0.0, 0.0, -1.0)).lerp(Vector((-side * 1.0, 0.0, 0.0)), up)
    # with a desk handset at the ear the elbow drops forward, in front of the chest, as when resting it
    reach(r, side, tuple(w), tuple(hand), palm=tuple(palm), elbow_out=0.7 - 0.5 * up,
          elbow_fwd=-0.2 + (1.0 * up if desk else 0.0))
    return r


def phone_keys(side=1, at=PHONE_AT):
    """Pick up and hold at the ear; put back down."""
    p = lambda st: phoning(st, side, at)
    return ([(0, p(0)), (10, p(1)), (14, p(1)), (26, p(1.8)), (30, p(2)), (36, p(2))],
            [(0, p(2)), (8, p(1.2)), (12, p(1)), (18, p(1)), (28, p(0))])


def mouse_keys(at=MOUSE_AT):
    """Hand on the mouse, a few small strokes and a pause, back to the lap."""
    w = [(0, 0), (0.025, 0.01), (-0.01, 0.02), (0.02, -0.015), (0.0, 0.0), (-0.02, 0.01), (0.015, 0.02), (0, 0)]
    keys = [(0, mousing(0, at=at)), (12, mousing(1, at=at))]
    keys += [(12 + 8 * (k + 1), mousing(1, xy, at)) for k, xy in enumerate(w)]
    return keys + [(84, mousing(1, at=at)), (96, mousing(0, at=at))]


# The desk PA mic (blender/props.make_mic, placed by control_room.STATION_PROPS):
# its red talk button and its foam head as seen from the chair, for the right
# desk's mic, which stands to his right (the left desk's mirrors it)
RADIO_BUTTON = (0.36, 0.59, 0.772)
RADIO_HEAD = (0.33, 0.47, 1.10)
# How he talks into it (Adriaen picks; every style is kept):
#   hold    holds the button down and leans right in to the mic
#   casual  holds the button, a small lean, mostly turns his head to it
#   tap     taps the button on, leans in with his forearm on the desk,
#           taps it off again
RADIO_STYLES = ("hold", "casual", "tap")
RADIO_STYLE = "hold"
RADIO_PREVIEW = os.environ.get("RADIO_PREVIEW") == "1"
RADIO_KEY = 14 / FPS                  # radio: the button goes down here (the radio keys)
RADIO_TALK = 24 / FPS                 # radio: at the mic, ready to talk; holds this pose
RADIO_OFF = 6 / FPS                   # radio_end: the button comes up here


def shoulder_full(r, side):
    """shoulder_seated with the spine and chest turned by their whole
    rotations (twists and side bends too), for poses that lean sideways."""
    def mat(bone):
        spec = r.get(bone, (X, 0))
        spec = spec if isinstance(spec, list) else [spec]
        m = Matrix.Identity(3)
        for ax, a in spec:
            m = Matrix.Rotation(math.radians(a), 3, Vector(ax)) @ m
        return m
    rs = mat("spine")
    rc = rs @ mat("chest")
    s = Vector((side * base.SHOULDER.x, base.SHOULDER.y, base.SHOULDER.z))
    p = Vector((0, 0, 1.0)) + rs @ Vector((0, 0, 0.18)) + rc @ (s - Vector((0, 0, 1.18)))
    return p + Vector(r.get("hips_offset", (0, 0, 0))), rc


# Leaned in to the mic, per style (fitted so his mouth ends 15 cm from the
# foam for hold and tap, 22 cm for casual): spine bend forward, twist to the
# mic, side bend; neck lift; head turn and lift; hips slid forward on the seat
RADIO_LEAN = {"hold": (-38, 34, 4, 24, 10, 24, 0.10),
              "casual": (-20, 24, 8, 18, 22, 16, 0.05),
              "tap": (-35, 32, 6, 24, 6, 24, 0.10)}


def radioing(side, reach_f, lean, press=0.0, style=RADIO_STYLE, talk=0.0):
    """Seated by the desk mic on his side (1 right, -1 left): reach_f 0
    resting to 1 the fingertips on the talk button, press pushes it down
    (1 cm), lean 0 upright to 1 his mouth at the mic. talk nods the head a
    little while he speaks. With style tap the hand leaves the button once
    it is on and the forearm rests on the desk while he leans in."""
    r = seated()
    bend, twist, tilt, neck, turn, lift, slide = RADIO_LEAN[style]
    # some lean already to reach the button, which is beyond his arm sitting upright
    k = max(lean, reach_f * min(1.0, 13 / -bend))
    r["spine"] = [(X, 6 + (bend - 6) * k), (Z, -side * twist * k), (Y, side * tilt * k)]
    r["neck"] = (X, -5 + (neck + 5) * k)
    r["head"] = [(Z, -side * turn * k), (X, -3 + (lift + 3) * k - 6 * reach_f * (1 - lean) - 3 * talk)]
    r["hips_offset"] = (0.0, -0.02 + slide * k, SEAT_DROP)
    if reach_f <= 0:
        return r
    button = Vector((side * RADIO_BUTTON[0], RADIO_BUTTON[1], RADIO_BUTTON[2]))
    lap = Vector((side * 0.20, 0.30, 0.62))
    hand = Vector((-side * 0.15, 0.75, -0.65)).normalized()
    # the fingertips (a hand's length on from the wrist) on the button
    w = button + Vector((0, 0, 0.012 - 0.01 * press)) - hand * 0.15
    hd = hand
    if style == "tap" and lean > 0:
        # the hand off the button, forearm down on the desk edge before the mic
        off = min(1.0, lean * 1.5)
        w = w.lerp(Vector((side * 0.26, 0.40, 0.80)), off)
        hd = hand.lerp(Vector((-side * 0.45, 0.85, -0.10)), off)
    w = lap.lerp(w, reach_f)
    reach(r, side, tuple(w), tuple(hd), palm=(0, 0, -1.0), elbow_out=0.8, elbow_fwd=-0.2, shoulder=shoulder_full)
    return r


def radio_keys(side=1, style=RADIO_STYLE):
    """radio: reach, key the mic (RADIO_KEY), lean in to it (at RADIO_TALK)
    and hold there while a player plays the reply; radio_end: sit back,
    let go of the button (RADIO_OFF), hand back to the lap."""
    p = lambda f, lean, press=0.0, talk=0.0: radioing(side, f, lean, press, style, talk)
    if style == "tap":
        on = [(0, p(0, 0)), (10, p(1, 0)), (13, p(1, 0, 1)), (16, p(1, 0)), (24, p(1, 1)),
              (36, p(1, 1, talk=1)), (48, p(1, 1))]
        off = [(0, p(1, 1)), (8, p(1, 0)), (10, p(1, 0, 1)), (13, p(1, 0)), (24, p(0, 0))]
        return on, off
    on = [(0, p(0, 0)), (10, p(1, 0)), (14, p(1, 0, 1)), (24, p(1, 1, 1)), (36, p(1, 1, 1, 1)), (48, p(1, 1, 1))]
    off = [(0, p(1, 1, 1)), (6, p(1, 0.4, 1)), (10, p(1, 0.1)), (22, p(0, 0))]
    return on, off


# When the puff comes out in the fart clips, seconds from the clip start:
# a player adds its cloud (and any sound) then
FART_PUFF = (0.75, 1.25)


def farting(f, glance=0.0, shudder=0.0, relief=0.0):
    """Standing: f = 0 rest to 1 leaning forward with the right knee lifted
    and the hips popped to the left; glance turns the head (degrees),
    shudder jiggles the hips (-1..1), relief lifts the chest and head."""
    r = standing(breath=1.5 * relief, head=glance)
    arms_down(r, lower=36 - 8 * f, swing=(2 + 6 * f, 2 + 6 * f), elbow=(12 + 14 * f, 12 + 14 * f))
    legs(r, "R", 22 * f, 30 * f, -6 * f)
    legs(r, "L", 3 * f, 4 * f)
    r["hips"] = [(Y, -9 * f + 2 * shudder), (X, 6 * f)]
    r["spine"] = [(X, -14 * f + 4 * relief), (Y, 7 * f)]
    r["chest"] = (X, -4 * f + 5 * relief)
    r["head"] = [(Z, glance), (X, 6 * f - 9 * relief)]
    r["hips_offset"] = (-0.02 * f + 0.004 * shudder, -0.01 * f, -0.012 * f)
    return r


def farting_seated(f, glance=0.0, shudder=0.0, relief=0.0):
    """Seated: f = 0 sitting to 1 rolled onto the left cheek, the right
    one lifted off the seat, leaning a little to the left."""
    r = seated(breath=1.2 * relief, head=glance)
    r["hips"] = (Y, -8 * f + 1.5 * shudder)
    r["spine"] = [(X, 6 - 4 * f + 3 * relief), (Y, 10 * f)]
    r["head"] = [(Z, glance), (X, -3 + 4 * f - 8 * relief)]
    r["hips_offset"] = (-0.012 * f + 0.003 * shudder, -0.02, SEAT_DROP + 0.025 * f)
    return r


def fart_keys(pose):
    """Glance round, lean in, shudder through the puff, relief, rest."""
    return [(0, pose(0)), (6, pose(0, glance=22)), (12, pose(0.3, glance=-18)), (18, pose(1)),
            (21, pose(1, shudder=1)), (24, pose(1, shudder=-1)), (27, pose(1, shudder=1)),
            (30, pose(1)), (40, pose(0.2, relief=1)), (52, pose(0, relief=0.8)), (60, pose(0))]


# Where a hugged prop sits in the rest pose, character space (metres, +Y
# ahead): parent it to the chest bone there and it follows the hug clip
HUG_HOLD = (0.0, 0.20, 1.12)


def hugging(rock=0.0, nuzzle=0.0):
    """Standing, cradling something about 0.3 m tall against the chest:
    rock (-1..1) sways the body from side to side, nuzzle tilts the head
    down and over to it."""
    r = standing()
    lean = 4 + 2 * abs(rock)
    r["hips"] = (Z, 6 * rock)
    r["spine"] = [(X, -lean), (Y, 3 * rock)]
    r["chest"] = [(Y, 4 * rock), (Z, 3 * rock)]
    r["neck"] = (X, -8 - 4 * nuzzle)
    r["head"] = [(X, -12 - 6 * nuzzle), (Y, -8 * nuzzle - 4 * rock)]
    world = Matrix.Rotation(math.radians(-lean), 3, X)
    # right forearm flat across under its bottom, left arm round its tummy
    aim(r, [("upper_arm.R", _arm(1), (0.12, 0.14, -1.0)),
            ("forearm.R", _arm(1), (-0.80, 0.58, 0.02), ((-0.707, 0, -0.707), (0, 0, -1.0))),
            ("hand.R", _arm(1), (-0.85, 0.30, 0.25))], world)
    aim(r, [("upper_arm.L", _arm(-1), (-0.10, 0.45, -1.0)),
            ("forearm.L", _arm(-1), (0.45, 0.89, 0.02), ((0.707, 0, -0.707), (0, -1.0, 0))),
            ("hand.L", _arm(-1), (0.95, 0.20, 0.0))], world)
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
    c["flying"] = [(k * 12, flying(k / 8)) for k in range(9)]
    c["point"] = [(0, pointing(0)), (10, pointing(1)), (36, pointing(1)), (48, pointing(0))]
    c["step_down"] = stepping_down()
    c["sip"] = sip_keys(1)
    c["sip_left"] = sip_keys(-1)
    c["mouse"] = mouse_keys()
    c["mouse_far"] = mouse_keys(MOUSE_FAR)
    c["phone"], c["phone_down"] = phone_keys()
    c["phone_left"], c["phone_left_down"] = phone_keys(-1, PHONE_DESK)
    c["radio"], c["radio_end"] = radio_keys()
    c["radio_left"], c["radio_left_end"] = radio_keys(-1)
    if RADIO_PREVIEW:   # the other styles too, as radio_<style>[_left][_end], for picking
        for st in RADIO_STYLES:
            if st != RADIO_STYLE:
                c[f"radio_{st}"], c[f"radio_{st}_end"] = radio_keys(1, st)
                c[f"radio_{st}_left"], c[f"radio_{st}_left_end"] = radio_keys(-1, st)
    c["fart"] = fart_keys(farting)
    c["fart_seated"] = fart_keys(farting_seated)
    c["hug"] = [(0, hugging(0, 1)), (24, hugging(1, 0.4)), (48, hugging(0, 1)), (72, hugging(-1, 0.4)),
                (96, hugging(0, 1))]
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


def face(brow_up=0.0, brow_tilt=0.0, eye_open=1.0, jaw=0.0, smile=0.0, wide=0.0):
    """Face pose: brows moved up (metres, negative down) and tilted with the
    inner ends down (degrees), eyes scaled in height (1 open, ~0.1 shut),
    the jaw dropped (metres, opens the mouth), the mouth corners raised
    (smile, negative frowns) and pulled out (wide, negative purses)."""
    r = {"jaw": {"loc": (0, 0, -jaw)}}
    for s, tag in ((1, "R"), (-1, "L")):
        r[f"brow.{tag}"] = {"loc": (0, 0, brow_up), "rot": (Y, -s * brow_tilt)}
        r[f"eye.{tag}"] = {"scale": eye_open}
        r[f"mouth.{tag}"] = {"loc": (s * wide, 0, smile)}
    return r


# Expressions: (brow_up, brow_tilt, eye_open, jaw, smile, wide)
EXPRESSIONS = {"happy": (0.003, -4, 0.7, 0.003, 0.008, 0.005),
               "sad": (0.001, -16, 0.85, 0.0, -0.007, -0.002),
               "surprised": (0.011, 0, 1.3, 0.013, 0.0, -0.008),
               "angry": (-0.006, 18, 0.7, 0.001, -0.004, 0.004),
               "worried": (0.005, -14, 1.05, 0.002, -0.003, -0.004)}
EYES, BROWS = {"eye.R", "eye.L"}, {"brow.R", "brow.L"}
MOUTH = {"mouth.R", "mouth.L"}


def _talk():
    """Two seconds of speech rhythm: the jaw opens by different amounts
    every few frames, with a pause, so a loop doesn't read as chewing."""
    opens = [0, 6, 2, 8, 3, 0, 5, 9, 4, 1, 7, 2, 0, 0, 6, 3, 0]
    return [(k * 3, face(jaw=0.0011 * o)) for k, o in enumerate(opens)]


def face_clips():
    """Face clips and the bones each one moves: a blink touches only the
    eyes and talking only the jaw, so either plays over an expression."""
    rest = face()
    clips = {"blink": ([(0, rest), (2, face(eye_open=0.1)), (4, face(eye_open=0.1)), (7, rest)], EYES),
             "brows_raise": ([(0, rest), (5, face(0.009, 0, 1.15)), (30, face(0.009, 0, 1.15)), (36, rest)],
                             EYES | BROWS),
             "brows_frown": ([(0, rest), (5, face(-0.004, 14, 0.75)), (30, face(-0.004, 14, 0.75)), (36, rest)],
                             EYES | BROWS),
             "talk": (_talk(), {"jaw"})}
    for name, p in EXPRESSIONS.items():
        bones = EYES | BROWS | MOUTH | ({"jaw"} if p[3] else set())
        clips[name] = ([(0, rest), (6, face(*p)), (54, face(*p)), (62, rest)], bones)
    return clips


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
    for name, (keys, _) in face_clips().items():
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
    face_bones = {name: bones for name, (_, bones) in face_clips().items()}
    for anim in gltf.get("animations", []):
        keep = face_bones.get(anim["name"])
        def wanted(c):
            bone = nodes[c["target"]["node"]].get("name")
            return bone in keep if keep is not None else bone not in base.FACE_BONES
        anim["channels"] = [c for c in anim["channels"] if wanted(c)]
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
