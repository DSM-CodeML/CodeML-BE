-- 잔디(활동 히트맵)용 활동 기록. activity_date는 KST 기준 날짜, created_at은 UTC.
CREATE TABLE user_activities (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       INT UNSIGNED    NOT NULL,
  activity_type VARCHAR(30)     NOT NULL,
  -- 대소문자만 다른 ref_id는 서로 다른 대상이다. 중복 방지(UNIQUE)도 같은 규칙으로 비교하도록 _bin collation
  ref_id        VARCHAR(64)     CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  activity_date DATE            NOT NULL,
  created_at    DATETIME        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_activities_dedup (user_id, activity_type, ref_id, activity_date),
  KEY idx_user_activities_user_date (user_id, activity_date),
  CONSTRAINT fk_user_activities_user FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
