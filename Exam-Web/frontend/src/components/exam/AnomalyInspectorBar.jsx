import { Link } from "react-router-dom";

export function filterRowsByAnomaly(rows = [], anomalyFilter = "ALL") {
  if (!anomalyFilter || anomalyFilter === "ALL") return rows;
  return rows.filter((row) => {
    if (anomalyFilter === "ANY") return Boolean(row.is_anomalous);
    if (anomalyFilter === "FAST") return Boolean(row.is_fast_completion);
    if (anomalyFilter === "VIOLATION") {
      return Boolean(row.is_high_violation || row.is_high_unfocus);
    }
    if (anomalyFilter === "COLLUSION") return Boolean(row.is_collusion_suspect);
    return true;
  });
}

export function AnomalyBadges({ row }) {
  if (!row?.is_anomalous) return null;
  return (
    <div className="anomaly-badges-wrap">
      {row.is_fast_completion && (
        <span
          className="anomaly-tag fast"
          title={`Hoàn thành chỉ trong ${row.duration_ratio_percent}% thời lượng đề thi`}
        >
          ⚡ Nộp nhanh ({row.duration_ratio_percent}% TG)
        </span>
      )}
      {row.is_high_violation && (
        <span
          className="anomaly-tag danger"
          title="Số lần vi phạm rời tab hoặc thoát toàn màn hình cao"
        >
          🚨 Vi phạm cao ({Number(row.tab_switch_count) || 0} lần)
        </span>
      )}
      {row.is_high_unfocus && (
        <span
          className="anomaly-tag warn"
          title="Tổng thời gian cửa sổ mất focus cao bất thường"
        >
          👀 Mất focus lớn ({Number(row.unfocused_seconds) || 0}s)
        </span>
      )}
      {row.is_collusion_suspect &&
        (row.collusion_matches || []).map((match, idx) => (
          <span
            key={idx}
            className="anomaly-tag collusion"
            title={`Trùng ${match.sameWrongCount} phương án sai giống hệt nhau (${match.similarityPercent}%) với ${match.partnerName} (${match.partnerCode})`}
          >
            👯 Trùng sai {match.similarityPercent}% với {match.partnerCode}
          </span>
        ))}
    </div>
  );
}

export default function AnomalyInspectorBar({
  summary,
  suspiciousPairs = [],
  activeFilter,
  onFilterChange,
  totalCount = 0,
  onCloseModal,
}) {
  const safeSummary = summary || {
    totalAnomalousCount: 0,
    fastCount: 0,
    highViolationOrUnfocusCount: 0,
    collusionStudentCount: 0,
    suspiciousPairCount: 0,
  };

  return (
    <div className="anomaly-inspector-panel">
      <div className="anomaly-filter-head">
        <span className="anomaly-filter-label">
          🔎 Bộ lọc phát hiện bài làm bất thường:
        </span>
        <div className="subject-pills-wrap">
          <button
            type="button"
            className={`filter-pill ${activeFilter === "ALL" ? "active" : ""}`}
            onClick={() => onFilterChange("ALL")}
          >
            Tất cả ({totalCount})
          </button>
          <button
            type="button"
            className={`filter-pill ${activeFilter === "ANY" ? "active" : ""}`}
            onClick={() => onFilterChange("ANY")}
          >
            ⚠️ Mọi bất thường ({safeSummary.totalAnomalousCount})
          </button>
          <button
            type="button"
            className={`filter-pill ${activeFilter === "FAST" ? "active" : ""}`}
            onClick={() => onFilterChange("FAST")}
          >
            ⚡ Nộp quá nhanh &lt;20% TG ({safeSummary.fastCount})
          </button>
          <button
            type="button"
            className={`filter-pill ${activeFilter === "VIOLATION" ? "active" : ""}`}
            onClick={() => onFilterChange("VIOLATION")}
          >
            🚨 Vi phạm / Mất focus cao ({safeSummary.highViolationOrUnfocusCount})
          </button>
          <button
            type="button"
            className={`filter-pill ${activeFilter === "COLLUSION" ? "active" : ""}`}
            onClick={() => onFilterChange("COLLUSION")}
          >
            👯 Trùng mẫu đáp án sai ({safeSummary.collusionStudentCount})
          </button>
        </div>
      </div>

      {suspiciousPairs.length > 0 && (
        <div className="collusion-pairs-alert">
          <div className="collusion-pairs-title">
            🚨 Phát hiện {suspiciousPairs.length} cặp thí sinh có tỷ lệ trùng mẫu đáp án sai bất thường:
          </div>
          <div className="collusion-pairs-list">
            {suspiciousPairs.map((pair, idx) => (
              <div key={idx} className="collusion-pair-item">
                <div className="collusion-pair-info">
                  <strong>
                    {pair.student1.fullName} ({pair.student1.studentCode})
                  </strong>
                  <span className="collusion-arrow">↔</span>
                  <strong>
                    {pair.student2.fullName} ({pair.student2.studentCode})
                  </strong>
                  <span className="anomaly-tag collusion">
                    Trùng {pair.sameWrongCount}/{pair.unionWrongCount} câu sai ({pair.similarityPercent}%)
                  </span>
                  {pair.examTitle && (
                    <span className="sub-text">• {pair.examTitle}</span>
                  )}
                </div>
                <div className="collusion-pair-actions">
                  <Link
                    to={`/results/${pair.student1.submissionId}`}
                    className="btn-sm edit"
                    onClick={onCloseModal}
                  >
                    Bài {pair.student1.studentCode}
                  </Link>
                  <Link
                    to={`/results/${pair.student2.submissionId}`}
                    className="btn-sm edit"
                    onClick={onCloseModal}
                  >
                    Bài {pair.student2.studentCode}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
