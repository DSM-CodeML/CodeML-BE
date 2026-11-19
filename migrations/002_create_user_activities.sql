-- 잔디(활동 히트맵)용 활동 기록. activity_date는 KST 기준 날짜, created_at은 UTC.
CREATE TABLE user_activities (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       INT UNSIGNED    NOT NULL,
  activity_type VARCHAR(30)     NOT NULL,
  ref_id        VARCHAR(64)     NOT NULL,
  activity_date DATE            NOT NULL,
  created_at    DATETIME        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_activities_dedup (user_id, activity_type, ref_id, activity_date),
  KEY idx_user_activities_user_date (user_id, activity_date),
  CONSTRAINT fk_user_activities_user FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
