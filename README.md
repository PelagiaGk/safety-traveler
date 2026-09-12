# 🌍 Safety Traveler


Safety Traveler uses data to make predictions as a safety measure.*It is not a forecaster*. 

This 24/7 web application provides real-time geospatial risk assessments based on the historical recurrence of terrestrial disasters (Wildfires, Floods, Earthquakes, Storms, Heatwaves, and Droughts). By combining live map interactions with a balanced Random Forest logic, it evaluates the probabilistic danger of a region based strictly on localized meteorological history.

<img width="1919" height="910" alt="image" src="https://github.com/user-attachments/assets/4d786991-b4bc-4ee4-8880-773bd6b411f0" />
---

## 🚀 Key Features
* Calibrated Machine Learning Pipeline: Powered by a RandomForestClassifier wrapped with CalibratedClassifierCV to ensure robust, statistically reliable output probabilities.
* Dynamic Percentile-Based Risk Tiering: Automatically calculates High, Medium, and Low risk boundaries dynamically from training distributions rather than relying on brittle, hardcoded cutoffs.
* Historical Base Rate Integration: Features spatio-temporal feature engineering that incorporates regional historical baseline frequencies alongside coordinates, season, and month.
* Intelligent Spatial Aggregation: Scans map boundaries via a FastAPI backend, executing grid-based multi-threat deduplication to surface distinct disaster types side-by-side without suppressing critical warnings.
* Explainability & Tailored Precautions: Generates automated reasoning for predictions and displays dynamic, category-specific safety precautions directly within the interactive frontend popups.

## 🛠️ Technology Stack

* Backend: Python, FastAPI, Gunicorn, Uvicorn
* Machine Learning: Scikit-learn, Pandas, NumPy, Joblib
* Spatial & Data Processing: GeoJSON, Shapely / Spatial coordinate filtering
* Frontend: Leaflet.js, HTML5, Modern CSS (Glassmorphism UI)
* Deployment: Render (Cloud PaaS)

## 📁 Repository Structure & File Handling
To maintain an open-source-friendly public repository, project assets are handled strategically:

* data/models/: Heavy binary artifacts (.joblib) are excluded from Git version control via .gitignore to prevent repository bloat. They are dynamically generated via train.py or fetched from GitHub Releases during deployment.
* data/processed/: Lightweight structured JSON/GeoJSON files (such as regional_disaster_index.geojson) are actively tracked in Git to guarantee out-of-the-box functionality for public users and seamless server boots.
* data/raw/: Raw datasets remain untracked locally and can be re-ingested via data pipelines.

## 🧠 Machine Learning Architecture & Certainty
This service utilizes a calibrated Random Forest Classifier operating on a 5-feature matrix (season_encoded, month, latitude, longitude, and historical_freq). It is explicitly designed to prioritize historical recurrence over generalized assumptions, anchoring predictions strictly to regional history and independent spatial features.

* Algorithm: Random Forest (n_estimators=200, min_samples_leaf=15, probability-calibrated)

* Class Balancing: Utilizes class_weight="balanced" to prevent heavily represented historical events (like Earthquakes) from artificially suppressing minority threats (like Droughts).

*Prevention of Overfitting:* The architecture strictly avoids mathematical scaling of spatial coordinates against time, preventing geometrical distance distortions. The min_samples_leaf=15 boundary ensures the model delivers nuanced, probabilistic threat profiles rather than rigid false certainties.

#### Evaluating Model Performance

![MODEL CERTAINTY](model_certainty.png)

* Understanding the Evaluation Results:

1. **Calibrated Probability Distribution:** The certainty histogram demonstrates a healthy, realistic spread of maximum class probabilities (centered primarily between 40% and 50%), confirming that the model's probability outputs are properly calibrated via Platt scaling rather than artificially overconfident.
2. **High-Confidence Risk Tails:** The secondary distribution extending past 60% up to ~72% highlights true high-conviction predictions, aligning perfectly with your dynamic percentile-based risk tiering (capturing robust upper-tail signals for High-risk classifications).
3. **Cured Class Bias & Generalization:** Balanced class weights paired with historical base rate engineering prevent the model from defaulting to majority classes (like Earthquakes), ensuring minority threats and regional anomalies are accurately surfaced across a balanced spectrum.

* Contributors can audit the live model's statistical certainty and view class imbalances by running the evaluation script:
```bash
python src/models/evaluate.py
```

## 💻 Getting Started (Local Development)
This repository includes a .devcontainer configuration, ensuring a standardized environment without polluting your local machine.

#### Prerequisites
1. Docker
2. VS Code with the "Dev Containers" extension

#### Setup Instructions
Clone the repository:

```bash
git clone [https://github.com/PelagiaGk/safety-traveler.git](https://github.com/PelagiaGk/safety-traveler.git)
cd safety-traveler
```

Open in Devcontainer:
Open the folder in VS Code. A prompt will appear to "Reopen in Container". Click it to automatically build the Docker environment and install all dependencies.

#### Generate the Data & Model:

```bash
python src/data/ingest_gdacs.py
python src/data/preprocess.py
python src/models/train.py
```
#### Run the Local Server:
```bash
uvicorn src.api.main:app --host 0.0.0.0 --port 8000 --reload
```

#### View the App
Navigate to http://localhost:8000 in your browser.

## 🛑 Contribution Guidelines
Community contributions, particularly in expanding our dataset to fix class imbalances (e.g., sourcing historical drought records) are highly welcomed. However, please adhere to these strict machine learning constraints:

1. Generalization > Memorization: Do not alter the Random Forest parameters to chase a 99% accuracy score.
2. Strict Bounding: The model must remain bounded to min_samples_leaf=15. Lowering this value forces the trees to overfit to exact terrestrial coordinates and artificially suppresses secondary threats.
3. Maintain Class Weights: Never remove the class_weight="balanced" parameter. Doing so will cause the model to regress into an Earthquake-only prediction engine due to GDACS dataset skews.
3. Data Integrity: All new spatial data must be strictly terrestrial. The OpenStreetMap reverse geocoder in ingest_gdacs.py must not be bypassed.

## 📄 License
This project is licensed under the MIT License - see the LICENSE file for details. This open-source structure ensures the community can freely use, modify, and distribute the software while contributing to global traveler safety.

*Safety Traveler is released as an open-source initiative to promote data transparency and global traveler safety.*
