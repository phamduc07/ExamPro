-- ============================================================================
-- HỆ THỐNG THI TRẮC NGHIỆM TRỰC TUYẾN PTIT (PTIT ONLINE EXAM SYSTEM)
-- Cơ sở dữ liệu: MySQL 8.0+
-- Số lượng bảng: 6 bảng có quan hệ khóa ngoại (1-N và N-N)
-- ============================================================================

CREATE DATABASE IF NOT EXISTS ptit_online_exam
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE ptit_online_exam;

-- 1. Bảng Người dùng (users)
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('STUDENT', 'TEACHER') NOT NULL DEFAULT 'STUDENT',
  student_code VARCHAR(30) DEFAULT NULL UNIQUE,
  major_group ENUM('KY_THUAT', 'KINH_TE') DEFAULT NULL,
  token_version INT NOT NULL DEFAULT 1,
  failed_login_attempts INT NOT NULL DEFAULT 0,
  locked_until DATETIME DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 2. Bảng Môn học (subjects)
CREATE TABLE IF NOT EXISTS subjects (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(30) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  created_by INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_subject_teacher FOREIGN KEY (created_by)
    REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- 3. Bảng Ngân hàng câu hỏi (questions)
CREATE TABLE IF NOT EXISTS questions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  subject_id INT NOT NULL,
  content TEXT NOT NULL,
  option_a TEXT NOT NULL,
  option_b TEXT NOT NULL,
  option_c TEXT NOT NULL,
  option_d TEXT NOT NULL,
  correct_answer ENUM('A', 'B', 'C', 'D') NOT NULL,
  difficulty ENUM('EASY', 'MEDIUM', 'HARD') NOT NULL DEFAULT 'MEDIUM',
  explanation TEXT,
  created_by INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_question_subject FOREIGN KEY (subject_id)
    REFERENCES subjects(id) ON DELETE CASCADE,
  CONSTRAINT fk_question_teacher FOREIGN KEY (created_by)
    REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- 4. Bảng Đề thi (exams)
CREATE TABLE IF NOT EXISTS exams (
  id INT AUTO_INCREMENT PRIMARY KEY,
  subject_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  duration_minutes INT NOT NULL DEFAULT 30,
  pass_score DECIMAL(4,2) NOT NULL DEFAULT 5.00,
  is_published TINYINT(1) NOT NULL DEFAULT 1,
  major_group ENUM('ALL', 'KY_THUAT', 'KINH_TE') NOT NULL DEFAULT 'ALL',
  exam_session VARCHAR(150) DEFAULT NULL,
  exam_shift VARCHAR(100) DEFAULT NULL,
  shuffle_questions TINYINT(1) NOT NULL DEFAULT 0,
  shuffle_options TINYINT(1) NOT NULL DEFAULT 0,
  anti_cheat TINYINT(1) NOT NULL DEFAULT 0,
  max_tab_switches INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 0,
  open_at DATETIME DEFAULT NULL,
  close_at DATETIME DEFAULT NULL,
  created_by INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_exam_subject FOREIGN KEY (subject_id)
    REFERENCES subjects(id) ON DELETE CASCADE,
  CONSTRAINT fk_exam_teacher FOREIGN KEY (created_by)
    REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- 5. Bảng trung gian Đề thi - Câu hỏi (exam_questions) - Quan hệ N-N
CREATE TABLE IF NOT EXISTS exam_questions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  exam_id INT NOT NULL,
  question_id INT NOT NULL,
  order_index INT NOT NULL DEFAULT 1,
  UNIQUE KEY uq_exam_question (exam_id, question_id),
  CONSTRAINT fk_eq_exam FOREIGN KEY (exam_id)
    REFERENCES exams(id) ON DELETE CASCADE,
  CONSTRAINT fk_eq_question FOREIGN KEY (question_id)
    REFERENCES questions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 6. Bảng Kết quả làm bài thi (submissions)
CREATE TABLE IF NOT EXISTS submissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  exam_id INT NOT NULL,
  student_id INT NOT NULL,
  score DECIMAL(4,2) NOT NULL DEFAULT 0.00,
  correct_count INT NOT NULL DEFAULT 0,
  total_questions INT NOT NULL DEFAULT 0,
  time_spent_seconds INT NOT NULL DEFAULT 0,
  started_at DATETIME DEFAULT NULL,
  tab_switch_count INT NOT NULL DEFAULT 0,
  answers_json JSON NOT NULL,
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sub_exam FOREIGN KEY (exam_id)
    REFERENCES exams(id) ON DELETE CASCADE,
  CONSTRAINT fk_sub_student FOREIGN KEY (student_id)
    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 7. Bảng Mã xác thực OTP đăng ký email (email_otps)
CREATE TABLE IF NOT EXISTS email_otps (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(150) NOT NULL UNIQUE,
  otp_hash VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  last_sent_at DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 8. Bảng Mã xác thực OTP 2FA đăng nhập Admin (login_otps)
CREATE TABLE IF NOT EXISTS login_otps (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  email VARCHAR(150) NOT NULL,
  otp_hash VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  last_sent_at DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_login_otp_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 9. Bảng Theo dõi trạng thái làm bài (exam_attempts)
CREATE TABLE IF NOT EXISTS exam_attempts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  exam_id INT NOT NULL,
  user_id INT NOT NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status ENUM('IN_PROGRESS', 'COMPLETED') NOT NULL DEFAULT 'IN_PROGRESS',
  UNIQUE KEY uq_exam_attempt (exam_id, user_id),
  CONSTRAINT fk_attempt_exam FOREIGN KEY (exam_id)
    REFERENCES exams(id) ON DELETE CASCADE,
  CONSTRAINT fk_attempt_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 10. Bảng Nhật ký thao tác Admin (admin_logs)
CREATE TABLE IF NOT EXISTS admin_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  admin_id INT DEFAULT NULL,
  admin_name VARCHAR(100) NOT NULL,
  action_type VARCHAR(50) NOT NULL,
  exam_title VARCHAR(255) NOT NULL,
  subject_code VARCHAR(50) DEFAULT NULL,
  details TEXT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 11. Bảng Mã OTP đặt lại mật khẩu (password_resets)
CREATE TABLE IF NOT EXISTS password_resets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(150) NOT NULL,
  otp_code VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  failed_attempts INT NOT NULL DEFAULT 0,
  used TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
