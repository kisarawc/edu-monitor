import os
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, confusion_matrix, accuracy_score
from sklearn.ensemble import RandomForestClassifier
import joblib

# --- CONFIGURATION ---
PUBLIC_CSV = r"C:\Users\chath\Desktop\Research\Dataset\public_features.csv"
LOCAL_CSV = r"C:\Users\chath\Desktop\Research\Dataset\custom_classroom_features.csv"


CLASS_NAMES = ["Listening", "Working", "Hand Raised", "Sleeping", "Turned Away"]

FEATURE_COLUMNS = [
    'torso_angle', 'shoulder_ratio', 'max_wrist_elevation', 
    'bbox_aspect_ratio', 'head_drop', 'shoulder_tilt', 
    'wrist_to_nose', 'wrist_distance', 'eye_distance'
]

# --- 1. LOAD DATASETS SEPARATELY ---
print("Loading datasets...")

if not os.path.exists(PUBLIC_CSV) or not os.path.exists(LOCAL_CSV):
    raise FileNotFoundError("Both public_features.csv and custom_classroom_features.csv must exist!")

public_df = pd.read_csv(PUBLIC_CSV).dropna()
local_df = pd.read_csv(LOCAL_CSV).dropna()

print(f"Public Dataset Size: {len(public_df)} instances")
print(f"Local CCTV Dataset Size: {len(local_df)} instances")

# --- 2. ACADEMIC DOMAIN SPLIT (NORMALIZED) ---
print("\nPerforming Domain-Specific Train/Test Split...")
local_train, local_test = train_test_split(
    local_df, test_size=0.2, random_state=42, stratify=local_df['target_class']
)

# NORMAL COMBINATION: 100% Public Data + 80% Local Data
train_df = pd.concat([public_df, local_train], ignore_index=True)

# The Testing Data = 20% Local Data ONLY (Pure CCTV performance)
test_df = local_test

X_train = train_df[FEATURE_COLUMNS]
y_train = train_df['target_class'].astype(int)

X_test = test_df[FEATURE_COLUMNS]
y_test = test_df['target_class'].astype(int)

print(f"Total Training Instances: {len(X_train)}")
print(f"Total Testing Instances:  {len(X_test)} (Pure Local CCTV Data Only)")

# --- 3. TRAIN GENERALIZED RANDOM FOREST MODEL ---
print("\nTraining Generalized Random Forest Classifier (Targeting ~85% Accuracy)...")

model = RandomForestClassifier(
    n_estimators=200,          
    max_depth=12,              # Increased from 6 to 12 to cure Underfitting
    min_samples_split=5,      
    min_samples_leaf=2,        
    class_weight='balanced',   # Forces the AI to pay attention to minority classes
    random_state=42,
    n_jobs=-1
)

model.fit(X_train, y_train)

# --- 4. EVALUATE THE MODEL ---
print("\n" + "="*50)
print("FINAL MODEL EVALUATION (ON UNSEEN CCTV DATA ONLY)")
print("="*50)

y_pred = model.predict(X_test)

accuracy = accuracy_score(y_test, y_pred)
print(f"Actual Overall Accuracy Achieved: {accuracy * 100:.2f}%\n")

# CRASH FIX: Dynamically find exactly which classes were tested or guessed
eval_classes = sorted(list(set(y_test) | set(y_pred)))
eval_class_names = [CLASS_NAMES[i] for i in eval_classes]

print("Detailed Classification Report:")
print(classification_report(y_test, y_pred, labels=eval_classes, target_names=eval_class_names, zero_division=0))

# --- 5. FEATURE IMPORTANCE ---
print("\n" + "="*50)
print("RANDOM FOREST FEATURE IMPORTANCE")
print("="*50)
importances = model.feature_importances_
for name, importance in sorted(zip(FEATURE_COLUMNS, importances), key=lambda x: x[1], reverse=True):
    print(f" - {name}: {importance * 100:.2f}% contribution")

# --- 6. GENERATE CONFUSION MATRIX ---
print("\nGenerating visual Confusion Matrix...")
# CRASH FIX: Ensure the matrix axis dynamically matches the eval_classes
cm = confusion_matrix(y_test, y_pred, labels=eval_classes)

plt.figure(figsize=(10, 8))
sns.heatmap(cm, annot=True, fmt='d', cmap='Blues', 
            xticklabels=eval_class_names, 
            yticklabels=eval_class_names)

plt.title(f'Generalized Random Forest Evaluation\n(Accuracy: {accuracy * 100:.2f}%)', fontsize=16)
plt.xlabel('Predicted Behavior (AI Guess)', fontsize=12, fontweight='bold')
plt.ylabel('Actual Behavior (Consensus Truth)', fontsize=12, fontweight='bold')
plt.tight_layout()

cm_filename = "confusion_matrix_final.png"
plt.savefig(cm_filename, dpi=300)
print(f"✅ Final confusion matrix successfully saved as '{cm_filename}'")
plt.show()

# --- 7. SAVE THE MODEL ---
print("\n" + "="*50)
print("SAVING MODEL")
print("="*50)
model_dir = os.path.join(os.path.dirname(__file__), "..", "models")
os.makedirs(model_dir, exist_ok=True)
model_path = os.path.join(model_dir, "classroom_behavior_model.pkl")
joblib.dump(model, model_path)
print(f"✅ Model successfully saved to '{model_path}'")
