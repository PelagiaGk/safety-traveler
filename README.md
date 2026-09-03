# 🌍 Safety Traveler

Safety Traveler uses data to make predictions as a safety measurement.*It is not a forecaster*. 

This 24/7 web application provides real-time geospatial risk assessments based on the historical recurrence of terrestrial disasters (Wildfires, Floods, Earthquakes, Storms, Heatwaves, and Droughts). By combining live map interactions with a balanced Random Forest logic, it evaluates the probabilistic danger of a region based strictly on localized meteorological history.

---

## 🚀 Features
*   **Interactive Global Map:** Built with Leaflet.js, featuring seamless point-and-click spatial resolution and dynamic radial emoji clustering for overlapping threats.
*   **Seasonal Threat Modeling:** Analyzes risks mathematically filtered by the selected season.
*   **Strict Reverse Geocoding:** Integrates OpenStreetMap's Nominatim API to dynamically sanitize dirty dataset coordinates, ensuring 100% of analyzed threats occur on verified landmasses with accurate regional naming.
*   **Live Backend Inference:** A lightweight FastAPI architecture serving optimized spatial predictions in milliseconds.
*   **Automated Data Ingestion:** GitHub Actions cron jobs continuously pull and normalize strictly terrestrial events from the Global Disaster Alert and Coordination System (GDACS).

---

## 🛠️ Technology Stack
*   **Backend:** Python 3.11, FastAPI, Uvicorn, Gunicorn (Production)
*   **Machine Learning:** Scikit-Learn (Random Forest), Pandas, Joblib
*   **Geospatial Processing:** Geopy (Nominatim)
*   **Frontend:** Vanilla JavaScript, HTML5, CSS3, Leaflet.js
*   **Infrastructure:** Devcontainer (Docker) for standardized local development

---

## 🧠 Machine Learning Architecture & Certainty

This service utilizes a **Random Forest Classifier**. It is explicitly designed to prioritize historical recurrence over generalized assumptions, anchoring predictions strictly to regional history and independent spatial features.

*   **Algorithm:** Random Forest (`n_estimators=200`, `min_samples_leaf=15`)
*   **Class Balancing:** Utilizes `class_weight="balanced"` to prevent heavily represented historical events (like Earthquakes) from artificially suppressing minority threats (like Droughts).
*   **Current Recurrence Accuracy:** `~59.70%` (Test Set) / `~52.08%` (Cross-Validation Mean)
*   **Prevention of Overfitting:** The architecture strictly avoids mathematical scaling of spatial coordinates against time, preventing "geometrical distance" distortions. The `min_samples_leaf=15` boundary ensures the model delivers nuanced, probabilistic threat profiles rather than rigid false certainties.

### Evaluating Model Performance
Contributors can audit the live model's statistical certainty and view class imbalances by running the evaluation script:
`python src/models/evaluate.py`

*(Note: Review the generated `model_certainty.png` Confusion Matrix to visualize the algorithm's probabilistic hedging).*

---

## 💻 Getting Started (Local Development)

This repository includes a `.devcontainer` configuration, ensuring a standardized environment without polluting your local machine.

### Prerequisites
*   [Docker](https://www.docker.com/)
*   [VS Code](https://code.visualstudio.com/) with the "Dev Containers" extension

### Setup Instructions
1.  **Clone the repository:**
    ```bash
    git clone [https://github.com/yourusername/safety-traveler.git](https://github.com/yourusername/safety-traveler.git)
    cd safety-traveler
    ```
2.  **Open in Devcontainer:**
    Open the folder in VS Code. A prompt will appear to "Reopen in Container". Click it to automatically build the Docker environment and install all dependencies.
3.  **Generate the Data & Model:**
    *(Raw data and heavy binaries are git-ignored to keep the repo lightweight).*
    ```bash
    python src/data/ingest_gdacs.py
    python src/data/preprocess.py
    python src/models/train.py
    ```
4.  **Run the Local Server:**
    ```bash
    uvicorn src.api.main:app --host 0.0.0.0 --port 8000 --reload