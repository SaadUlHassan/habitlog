-- Runs once, on first boot of an empty volume, against the database named by
-- MYSQL_DATABASE. No `USE` statement on purpose: the entrypoint already selects it,
-- and hardcoding a name here would break if the compose env changed.

CREATE TABLE users (
  id           BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  email        VARCHAR(255) NOT NULL UNIQUE,
  display_name VARCHAR(120) NOT NULL,
  -- IANA name, not an offset: an offset cannot express DST, so it would be wrong
  -- for half the year for anywhere that observes it.
  timezone     VARCHAR(64) NOT NULL DEFAULT 'Asia/Singapore',
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE = InnoDB;

CREATE TABLE habits (
  id           BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED NOT NULL,
  name         VARCHAR(120) NOT NULL,
  -- The brief's examples are not one shape: exercise is done/not-done, water is a
  -- daily total, sleep is a nightly reading. kind + aggregation model that difference
  -- instead of flattening it into "did you do it".
  kind         ENUM('boolean', 'quantity') NOT NULL,
  target_value DECIMAL(10, 2) NOT NULL DEFAULT 1,
  unit         VARCHAR(20) NOT NULL DEFAULT '',
  -- How an incoming reading combines with the day's existing value, applied at write
  -- time. 'sum' for water and minutes, 'last' where a later reading corrects an
  -- earlier one (sleep, weight).
  aggregation  ENUM('sum', 'last') NOT NULL DEFAULT 'sum',
  archived_at  TIMESTAMP NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- A target of zero would make every day a counting day and quietly render every
  -- streak meaningless, so it is refused here and not only in request validation.
  CONSTRAINT ck_habits_target_positive CHECK (target_value > 0),
  -- Enforces the rule the API applies on creation: re-logging a boolean habit under
  -- 'sum' would accumulate to 2, and the day cell would read "2 of 1 done".
  CONSTRAINT ck_habits_boolean_last CHECK (kind <> 'boolean' OR aggregation = 'last'),

  CONSTRAINT fk_habits_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  -- Parent key for habit_logs' composite foreign key below. Redundant on its own,
  -- since id is already the primary key.
  UNIQUE KEY uq_habits_id_user (id, user_id),
  INDEX idx_habits_user_active (user_id, archived_at)
) ENGINE = InnoDB;

CREATE TABLE habit_logs (
  id         BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  habit_id   BIGINT UNSIGNED NOT NULL,
  -- Denormalised so ownership filtering never needs a join.
  user_id    BIGINT UNSIGNED NOT NULL,
  value      DECIMAL(10, 2) NOT NULL,
  -- The user's calendar date at the moment of logging, derived server-side from
  -- their timezone. Stored alongside logged_at because they answer different
  -- questions: local_date is "which day does this count towards", logged_at is
  -- "when did this actually happen". Neither can be derived from the other without
  -- knowing the timezone at that instant.
  local_date DATE NOT NULL,
  logged_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Composite rather than a plain habit_id reference: this is what stops the
  -- denormalised user_id drifting away from habits.user_id and quietly breaking
  -- the ownership filter it exists to serve.
  CONSTRAINT fk_logs_habit_user FOREIGN KEY (habit_id, user_id)
    REFERENCES habits (id, user_id) ON DELETE CASCADE,

  -- Load-bearing. One row per habit per local date is what makes the log write a
  -- single atomic upsert instead of a read-then-write that races under concurrent
  -- submissions. It also means aggregation happens on write, never on read.
  UNIQUE KEY uq_logs_habit_date (habit_id, local_date),
  INDEX idx_logs_user_date (user_id, local_date)
) ENGINE = InnoDB;
