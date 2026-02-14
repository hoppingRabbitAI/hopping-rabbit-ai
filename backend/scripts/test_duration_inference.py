"""Quick test for _infer_transition_duration logic."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.template_render_service import TemplateRenderService

infer = TemplateRenderService._infer_transition_duration

cases = [
    # (label, template_record, expected)
    ("slow pacing", {"workflow": {"pacing": "slow"}, "metadata": {}}, "10"),
    ("morph+1200ms", {"metadata": {"transition_spec": {"family": "morph", "duration_ms": 1200}}, "workflow": {}}, "10"),
    ("morph+500ms (short)", {"metadata": {"transition_spec": {"family": "morph", "duration_ms": 500}}, "workflow": {}}, "5"),
    ("dolly_zoom+1000ms", {"metadata": {"transition_spec": {"family": "dolly_zoom", "duration_ms": 1000}}, "workflow": {}}, "10"),
    ("orbit+900ms", {"metadata": {"transition_spec": {"camera_movement": "orbit", "duration_ms": 900}}, "workflow": {}}, "10"),
    ("orbit+600ms (short)", {"metadata": {"transition_spec": {"camera_movement": "orbit", "duration_ms": 600}}, "workflow": {}}, "5"),
    ("spin+1600ms (ultra long)", {"metadata": {"transition_spec": {"family": "spin", "duration_ms": 1600}}, "workflow": {}}, "10"),
    ("spin+600ms (default)", {"metadata": {"transition_spec": {"family": "spin", "duration_ms": 600}}, "workflow": {}}, "5"),
    ("no metadata", {"metadata": None, "workflow": {}}, "5"),
    ("empty everything", {"workflow": {}}, "5"),
]

passed = 0
for label, record, expected in cases:
    result = infer(record)
    ok = result == expected
    mark = "PASS" if ok else "FAIL"
    print(f"  [{mark}] {label:30s} -> {result} (expected {expected})")
    if ok:
        passed += 1

print(f"\n{passed}/{len(cases)} passed")
if passed == len(cases):
    print("All assertions passed!")
else:
    sys.exit(1)
