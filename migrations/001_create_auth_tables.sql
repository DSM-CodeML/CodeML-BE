-- 인증 테이블 생성 (users, auth_sessions, refresh_tokens)
-- 모든 DATETIME 값은 UTC로 저장한다.

CREATE TABLE users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- 구글 sub는 대소문자를 구분해 비교해야 하므로 _bin collation
  google_sub    VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  email         VARCHAR(254) NULL,
  nickname      VARCHAR(50)  NOT NULL,
  created_at    DATETIME     NOT NULL,
  last_login_at DATETIME     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_google_sub (google_sub)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE auth_sessions (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    INT UNSIGNED NOT NULL,
  created_at DATETIME     NOT NULL,
  expires_at DATETIME     NOT NULL,
  revoked_at DATETIME     NULL,
  PRIMARY KEY (id),
  KEY idx_auth_sessions_user_id (user_id),
  KEY idx_auth_sessions_expires_at (expires_at),
  CONSTRAINT fk_auth_sessions_user FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE refresh_tokens (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  session_id INT UNSIGNED    NOT NULL,
  token_hash BINARY(32)      NOT NULL,
  issued_at  DATETIME        NOT NULL,
  expires_at DATETIME        NOT NULL,
  used_at    DATETIME        NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_refresh_tokens_token_hash (token_hash),
  KEY idx_refresh_tokens_session_id (session_id),
  KEY idx_refresh_tokens_expires_at (expires_at),
  CONSTRAINT fk_refresh_tokens_session FOREIGN KEY (session_id) REFERENCES auth_sessions (id)
    ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
