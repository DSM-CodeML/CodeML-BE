-- 커리큘럼/문제/제출 테이블 + 회원 경험치(xp). 모든 DATETIME 값은 UTC로 저장한다.

ALTER TABLE users ADD COLUMN xp INT UNSIGNED NOT NULL DEFAULT 0;

-- 주차(대표 커리큘럼의 한 단계). total 은 목표 문제 수(등록된 문제 수보다 클 수 있다)
CREATE TABLE weeks (
  n        VARCHAR(8)   NOT NULL,
  ord      TINYINT UNSIGNED NOT NULL,
  course   VARCHAR(100) NOT NULL,
  libs     VARCHAR(100) NOT NULL,
  project  VARCHAR(200) NOT NULL,
  optional TINYINT(1)   NOT NULL DEFAULT 0,
  total    SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (n),
  UNIQUE KEY uq_weeks_ord (ord)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 해설/개념 HTML 은 운영자가 직접 넣는 값이다(사용자 입력 아님)
CREATE TABLE problems (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  week_n         VARCHAR(8)   NOT NULL,
  title          VARCHAR(100) NOT NULL,
  level          ENUM('Easy','Medium') NOT NULL,
  xp             SMALLINT UNSIGNED NOT NULL DEFAULT 10,
  chapter        VARCHAR(100) NOT NULL,
  statement_html TEXT NOT NULL,
  solution_html  TEXT NOT NULL,
  concept_html   TEXT NOT NULL,
  starter_code   TEXT NOT NULL,
  PRIMARY KEY (id),
  KEY idx_problems_week (week_n),
  CONSTRAINT fk_problems_week FOREIGN KEY (week_n) REFERENCES weeks (n)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 채점용 테스트케이스. is_sample=1 만 사용자에게 보여 준다(나머지는 숨김 케이스)
CREATE TABLE problem_cases (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  problem_id      INT UNSIGNED NOT NULL,
  ord             TINYINT UNSIGNED NOT NULL,
  input_text      TEXT NOT NULL,
  expected_output TEXT NOT NULL,
  is_sample       TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_problem_cases_order (problem_id, ord),
  CONSTRAINT fk_problem_cases_problem FOREIGN KEY (problem_id) REFERENCES problems (id)
    ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE submissions (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    INT UNSIGNED    NOT NULL,
  problem_id INT UNSIGNED    NOT NULL,
  result     ENUM('Accepted','Wrong Answer','Compile Error') NOT NULL,
  language   VARCHAR(20)     NOT NULL,
  code       TEXT            NOT NULL,
  created_at DATETIME        NOT NULL,
  PRIMARY KEY (id),
  KEY idx_submissions_problem (problem_id, id),
  KEY idx_submissions_user (user_id, id),
  CONSTRAINT fk_submissions_user FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_submissions_problem FOREIGN KEY (problem_id) REFERENCES problems (id)
    ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
