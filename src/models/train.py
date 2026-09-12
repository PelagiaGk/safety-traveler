"""Model training pipeline prioritizing independent spatial feature splitting."""
import sys
from pathlib import Path
import joblib
import pandas as pd
from sklearn.model_selection import train_test_split, cross_val_score, KFold
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import LabelEncoder

BASE_DIR = Path(__file__).resolve().parents[2]
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

RAW_DATA_PATH = BASE_DIR / "data" / "raw" / "disasters_raw.json"
MODEL_PATH = BASE_DIR / "data" / "models" / "rf_disaster_model.joblib"
ENCODERS_PATH = BASE_DIR / "data" / "models" / "encoders.joblib"

def train_model():
    if not RAW_DATA_PATH.exists():
        print("Raw data not found. Run dataset generation first.")
        return

    df = pd.read_json(RAW_DATA_PATH)
    df = df.dropna(subset=["latitude", "longitude", "season", "disaster_type"])

    min_year = int(df["year"].min()) if "year" in df.columns else 2010
    max_year = int(df["year"].max()) if "year" in df.columns else 2026
    years_span = max(1, max_year - min_year + 1) 

    le_season = LabelEncoder()
    le_disaster = LabelEncoder()

    df["season_encoded"] = le_season.fit_transform(df["season"])
    df["target"] = le_disaster.fit_transform(df["disaster_type"])

    X = df[["season_encoded", "month", "latitude", "longitude"]]
    y = df["target"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    clf = RandomForestClassifier(
        n_estimators=200,
        min_samples_leaf=15,
        class_weight="balanced",
        random_state=42
    )
    
    kf = KFold(n_splits=5, shuffle=True, random_state=42)
    cv_scores = cross_val_score(clf, X_train, y_train, cv=kf)
    
    clf.fit(X_train, y_train)
    test_accuracy = clf.score(X_test, y_test)

    print("Model Trained Successfully")
    print(f"Historical Data Span: {years_span} years")
    print(f"Cross-Validation Mean Accuracy: {cv_scores.mean() * 100:.2f}% (+/- {cv_scores.std() * 100:.2f}%)")
    print(f"Final Test Set Accuracy: {test_accuracy * 100:.2f}%")

    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(clf, MODEL_PATH)
    joblib.dump({
        "season": le_season,
        "disaster": le_disaster,
        "feature_cols": ["season_encoded", "month", "latitude", "longitude"],
        "training_years_span": years_span
    }, ENCODERS_PATH)

if __name__ == "__main__":
    train_model()