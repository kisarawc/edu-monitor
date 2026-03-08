import sys
import os

# Ensure modules can be found
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from modules.teacher_behavior.inference import run_teacher_inference

import modules.teacher_behavior.api as _api

gen = run_teacher_inference()

print("Starting dual-camera frame loop (simulating client stream)...")
try:
    for i, frame in enumerate(gen):
        if i % 30 == 0:
            print(f"Processed frame {i}")
        if i == 100:
            print("Force registering teacher for simulation...")
            _api.TEACHER_REGISTERED = True
            _api.BOUNDARY_Y = 500
        if i > 1000: # Don't run forever
            break
    print("Successfully processed 1000 frames.")
except StopIteration:
    print("Generator exited immediately (StopIteration).")
except Exception as e:
    print(f"\nCRASH CAUGHT DURING STREAM: {e}")
    import traceback
    traceback.print_exc()
