"""Model evaluation and certainty visualization script."""
import sys
from pathlib import Path
import joblib
import pandas as pd
import matplotlib.pyplot as plt
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, accuracy_score

BASE_DIR = Path(__file__).resolve().parents[2]
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

RAW_DATA_PATH = BASE_DIR / "data" / "raw" / "disasters_raw.json"
MODEL_PATH = BASE_DIR / "data" / "models" / "rf_disaster_model.joblib"
ENCODERS_PATH = BASE_DIR / "data" / "models" / "encoders.joblib"
OUTPUT_IMAGE_PATH = BASE_DIR / "model_certainty.png"

def evaluate_certainty():
    if not RAW_DATA_PATH.exists() or not MODEL_PATH.exists() or not ENCODERS_PATH.exists():
        print("Required model artifacts or raw data missing. Run train.py first.")
        return

    model = joblib.load(MODEL_PATH)
    encoders = joblib.load(ENCODERS_PATH)
    
    le_season = encoders["season"]
    le_disaster = encoders["disaster"]
    feature_cols = encoders["feature_cols"]
    historical_freq_lookup = encoders.get("historical_freq_lookup", {})

    df = pd.read_json(RAW_DATA_PATH)
    df = df.dropna(subset=["latitude", "longitude", "season", "disaster_type", "region"])

    df["season_encoded"] = le_season.transform(df["season"])
    df["target"] = le_disaster.transform(df["disaster_type"])

    df["historical_freq"] = df.apply(
        lambda row: historical_freq_lookup.get((row["region"], row["disaster_type"]), 0.05), 
        axis=1
    )

    X = df[feature_cols]
    y = df["target"]

    _, X_test, _, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    y_pred = model.predict(X_test)
    accuracy = accuracy_score(y_test, y_pred)

    print(f"Evaluation Test Set Accuracy: {accuracy * 100:.2f}%")
    print("\nClassification Report:")
    print(classification_report(y_test, y_pred, target_names=le_disaster.classes_))

    plt.figure(figsize=(8, 5))
    probabilities = model.predict_proba(X_test)
    max_probs = probabilities.max(axis=1) * 100

    plt.hist(max_probs, bins=20, color="#3b82f6", edgecolor="black", alpha=0.8)
    plt.title("Model Prediction Certainty Distribution", fontsize=14, fontweight="bold")
    plt.xlabel("Maximum Class Probability (%)", fontsize=12)
    plt.ylabel("Sample Count", fontsize=12)
    plt.grid(True, linestyle="--", alpha=0.5)
    
    plt.tight_layout()
    plt.savefig(OUTPUT_IMAGE_PATH, dpi=300)
    print(f"Evaluation plot successfully saved to {OUTPUT_IMAGE_PATH}")

if __name__ == "__main__":
    evaluate_certainty()