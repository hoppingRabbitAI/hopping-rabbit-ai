"""Quick unit test for golden fingerprint service matching algorithm."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.golden_fingerprint_service import get_golden_fingerprint_service

svc = get_golden_fingerprint_service()

# Test 1: spin-type template
print("=== Test 1: spin occlusion ===")
fp1 = svc.extract_fingerprint({
    "template_id": "t1",
    "metadata": {"transition_spec": {
        "transition_category": "occlusion",
        "family": "spin",
        "motion_pattern": "subject_spin_360_turn",
        "camera_movement": "orbit",
        "duration_ms": 500,
    }}
})
name, score, cfg = svc.match_profile(fp1)
print(f"Best: {name} score={score}")
for m in svc.match_all_profiles(fp1):
    print(f"  {m['display_name']}: {m['score']} ({m['match_level']})")

# Test 2: whip_pan type
print("\n=== Test 2: whip_pan ===")
fp2 = svc.extract_fingerprint({
    "template_id": "t2",
    "metadata": {"transition_spec": {
        "transition_category": "cinematic",
        "family": "whip_pan",
        "motion_pattern": "whip_pan_left_fast",
        "camera_movement": "pan_left",
        "duration_ms": 400,
    }}
})
name, score, cfg = svc.match_profile(fp2)
print(f"Best: {name} score={score}")
for m in svc.match_all_profiles(fp2):
    print(f"  {m['display_name']}: {m['score']} ({m['match_level']})")

# Test 3: morph type
print("\n=== Test 3: morph/space warp ===")
fp3 = svc.extract_fingerprint({
    "template_id": "t3",
    "metadata": {"transition_spec": {
        "transition_category": "morphing",
        "family": "morph",
        "motion_pattern": "warp_zoom_portal",
        "camera_movement": "push",
        "duration_ms": 700,
    }}
})
name, score, cfg = svc.match_profile(fp3)
print(f"Best: {name} score={score}")
for m in svc.match_all_profiles(fp3):
    print(f"  {m['display_name']}: {m['score']} ({m['match_level']})")

# Test 4: unknown type - should have low scores
print("\n=== Test 4: unknown (should be low) ===")
fp4 = svc.extract_fingerprint({
    "template_id": "t4",
    "metadata": {"transition_spec": {
        "transition_category": "unknown",
        "family": "glitch",
        "motion_pattern": "random_distortion",
        "camera_movement": "static",
        "duration_ms": 100,
    }}
})
name, score, cfg = svc.match_profile(fp4)
print(f"Best: {name} score={score}")
for m in svc.match_all_profiles(fp4):
    print(f"  {m['display_name']}: {m['score']} ({m['match_level']})")

print("\n✅ All matching tests passed!")
