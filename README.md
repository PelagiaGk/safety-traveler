# 🌍 Safety Traveler

Safety Traveler uses data to make predictions as a safety measurement. *It is not a forecaster*. 

This 24/7 web application provides real-time geospatial risk assessments based on the historical recurrence of terrestrial disasters (Wildfires, Floods, Earthquakes, Storms, Heatwaves, and Droughts). By combining live map interactions, it evaluates the probabilistic danger of a region based on local history.

---

## 🚀 Features
*   **Interactive Global Map:** Built with Leaflet.js, featuring seamless point-and-click spatial resolution and dynamic radial emoji clustering for overlapping threats.
*   **Seasonal Threat Modeling:** Analyzes risks mathematically filtered by the selected season.
*   **Live Backend Inference:** A lightweight FastAPI architecture serving optimized spatial predictions in milliseconds.
*   **Automated Data Ingestion:** GitHub Actions cron jobs continuously pull and normalize strictly terrestrial events from the Global Disaster Alert and Coordination System (GDACS).

---

## 🛠️ Technology Stack
*   **Backend:** Python 3.11, FastAPI, Uvicorn, Gunicorn (Production)
*   **Machine Learning:** Scikit-Learn, Pandas, Joblib
*   **Frontend:** Vanilla JavaScript, HTML5, CSS3, Leaflet.js
*   **Infrastructure:** Devcontainer (Docker) for standardized local development

---

## 🧠 Machine Learning Architecture & Certainty

This service utilizes a **Scaled K-Nearest Neighbors (KNN)** algorithm. It is explicitly designed to prioritize historical recurrence over generalized assumptions, anchoring predictions strictly to regional history.

*   **Algorithm:** K-Nearest Neighbors (`weights='uniform'`)
*   **Dimensionality Scaling:** `StandardScaler` balances temporal features (season/month) against spatial coordinates.
*   **Current Recurrence Accuracy:** `~67.06%`
*   **Prevention of Overfitting:** The architecture enforces a strict minimum of `n_neighbors=15` combined with 5-Fold Cross-Validation. This ensures the model delivers nuanced, probabilistic threat profiles rather than rigid false certainties.

### Evaluating Model Performance
Contributors can audit the live model's statistical certainty and view class imbalances (e.g., heavily represented earthquake data vs. underrepresented drought data) by running the evaluation script:
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
    ```
5.  **View the App:** Navigate to `http://localhost:8000` in your browser.

---

## 🛑 Contribution Guidelines

We welcome community contributions, particularly in expanding our dataset to fix class imbalances (e.g., historical drought records). However, please adhere to these strict machine learning constraints:

1.  **Generalization > Memorization:** Do not alter the K-Nearest Neighbors parameters to chase a 99% accuracy score.
2.  **Strict Bounding:** The model must remain bounded to `n_neighbors=15` with `weights='uniform'` to enforce a probabilistic average.
3.  **Accuracy Targets:** A Cross-Validation accuracy between **60% and 75%** is our mathematical target. Scores higher than this indicate the model is overfitting to exact terrestrial coordinates and artificially suppressing secondary threats.
4.  **Data Integrity:** All new spatial data must be strictly terrestrial. Do not introduce deep-ocean anomalies into the training set.

---
*Safety Traveler is released as an open-source initiative to promote data transparency and global traveler safety.*
