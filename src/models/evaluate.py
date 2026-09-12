"""Model evaluation and certainty visualization for Random Forest architecture."""
import sys
from pathlib import Path
import joblib
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from sklearn.model_selection import train_test_split
from sklearn.metrics import confusion_matrix, classification_report

BASE_DIR = Path(__file__).resolve().parents[2]
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

RAW_DATA_PATH = BASE_DIR / "data" / "raw" / "disasters_raw.json"
MODEL_PATH = BASE_DIR / "data" / "models" / "rf_disaster_model.joblib"
ENCODERS_PATH = BASE_DIR / "data" / "models" / "encoders.joblib"
OUTPUT_IMG_PATH = BASE_DIR / "model_certainty.png"

def evaluate_certainty():
    if not RAW_DATA_PATH.exists() or not MODEL_PATH.exists():
        print("Data or model missing. Run training pipeline first.")
        return

    df = pd.read_json(RAW_DATA_PATH).dropna(subset=["latitude", "longitude", "season", "disaster_type"])
    
    model = joblib.load(MODEL_PATH)
    encoders = joblib.load(ENCODERS_PATH)
    
    le_season = encoders["season"]
    le_disaster = encoders["disaster"]
    
    df["season_encoded"] = le_season.transform(df["season"])
    df["target"] = le_disaster.transform(df["disaster_type"])

    X = df[["season_encoded", "month", "latitude", "longitude"]]
    y = df["target"]

    _, X_test, _, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)

    y_pred = model.predict(X_test)
    classes = le_disaster.inverse_transform(model.classes_)

    print("--- Model Certainty Report ---")
    print(classification_report(y_test, y_pred, target_names=classes))

    cm = confusion_matrix(y_test, y_pred)
    plt.figure(figsize=(8, 6))
    sns.heatmap(cm, annot=True, fmt='d', cmap='Blues', xticklabels=classes, yticklabels=classes)
    plt.title("Disaster Prediction Certainty (Confusion Matrix)")
    plt.ylabel("Actual Historical Event")
    plt.xlabel("Model Prediction")
    plt.tight_layout()
    
    plt.savefig(OUTPUT_IMG_PATH, dpi=300)
    print(f"Visual matrix saved to {OUTPUT_IMG_PATH}")

if __name__ == "__main__":
    evaluate_certainty()