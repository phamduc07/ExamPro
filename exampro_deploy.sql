-- --------------------------------------------------------
-- Máy chủ:                      127.0.0.1
-- Phiên bản máy chủ:            10.11.19-MariaDB - MariaDB Server
-- HĐH máy chủ:                  Win64
-- HeidiSQL Phiên bản:           12.22.0.7382
-- --------------------------------------------------------

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET NAMES utf8 */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

-- Đang kết xuất đổ cấu trúc cho bảng ptit_online_exam.admin_logs
CREATE TABLE IF NOT EXISTS `admin_logs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `admin_id` int(11) DEFAULT NULL,
  `admin_name` varchar(100) NOT NULL,
  `action_type` varchar(50) NOT NULL,
  `exam_title` varchar(255) NOT NULL,
  `subject_code` varchar(50) DEFAULT NULL,
  `details` text DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Đang kết xuất đổ dữ liệu cho bảng ptit_online_exam.admin_logs: ~11 rows (xấp xỉ)
INSERT INTO `admin_logs` (`id`, `admin_id`, `admin_name`, `action_type`, `exam_title`, `subject_code`, `details`, `created_at`) VALUES
	(1, 5, 'Phạm Anh Đức', 'CREATE_EXAM', 'ĐỀ GK1 Lần 1', 'INT1434', 'Thêm đề mới gồm 2 câu hỏi (25 phút)', '2026-11-24 05:15:37'),
	(2, 5, 'Phạm Anh Đức', 'UPDATE_EXAM', 'ĐỀ GK1 Lần 1', 'INT1434', 'Cập nhật đề thi (2 câu hỏi, 25 phút)', '2026-11-24 22:05:46'),
	(3, 5, 'Phạm Anh Đức', 'UNSUSPEND_SUBMISSION', 'ĐỀ GK1 Lần 1', 'INT1434', 'Gỡ vi phạm & mở lại lượt thi cho SV Ngô Thanh Phong (B25DCCC170)', '2026-11-24 22:46:22'),
	(4, 5, 'Phạm Anh Đức', 'UNSUSPEND_SUBMISSION', 'ĐỀ GK1 Lần 1', 'INT1434', 'Gỡ vi phạm & mở lại lượt thi cho SV Lê Đăng Khoa (B25DCCC110)', '2026-11-24 22:46:26'),
	(5, 5, 'Quản trị viên Hệ thống (PTIT)', 'CREATE_ADMIN', 'Duc (phamduc1011a@gmail.com)', NULL, 'Cấp quyền Admin mới (yêu cầu Super Admin duyệt lần đăng nhập đầu tiên)', '2026-11-25 12:24:21'),
	(6, 5, 'Quản trị viên Hệ thống (PTIT)', 'UNSUSPEND_SUBMISSION', 'Đề luyện tập nhanh: Cấu trúc dữ liệu & Giải thuật căn bản', 'INT1306', 'Gỡ vi phạm & mở lại lượt thi cho SV Lê Đăng Khoa (B25DCCC110)', '2026-11-25 16:11:39'),
	(7, 5, 'Quản trị viên Hệ thống (PTIT)', 'UNSUSPEND_SUBMISSION', 'Đề luyện tập nhanh: Cấu trúc dữ liệu & Giải thuật căn bản', 'INT1306', 'Gỡ vi phạm & mở lại lượt thi cho SV Quản trị viên Hệ thống (PTIT) (GV001)', '2026-11-25 16:11:49'),
	(8, 5, 'Quản trị viên Hệ thống (PTIT)', 'REOPEN_EXAM', 'ĐỀ GK1 Lần 1', 'INT1434', 'Mở lại đề thi đã đóng (mở tự do)', '2026-11-25 16:15:08'),
	(9, 5, 'Quản trị viên Hệ thống (PTIT)', 'UPDATE_EXAM', 'ĐỀ GK1 Lần 1', 'INT1434', 'Cập nhật đề thi (2 câu hỏi, 25 phút)', '2026-11-25 16:15:40'),
	(10, 5, 'Quản trị viên Hệ thống (PTIT)', 'UNSUSPEND_SUBMISSION', 'ĐỀ GK1 Lần 1', 'INT1434', 'Gỡ vi phạm & mở lại lượt thi cho SV Lê Đăng Khoa (B25DCCC110)', '2026-11-25 16:17:33'),
	(11, 11, 'Quản trị viên Hệ thống (PTIT)', 'UNSUSPEND_SUBMISSION', 'ĐỀ GK1 Lần 1', 'INT1434', 'Gỡ vi phạm & mở lại lượt thi cho SV Lê Đăng Khoa (B25DCCC110)', '2026-11-25 16:33:44'),
	(12, 5, 'Quản trị viên Hệ thống (PTIT)', 'CREATE_EXAM', 'Đề 01', 'FIN1202', 'Thêm đề mới gồm 5 câu hỏi (25 phút)', '2026-11-25 21:55:48');

-- Đang kết xuất đổ cấu trúc cho bảng ptit_online_exam.email_otps
CREATE TABLE IF NOT EXISTS `email_otps` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `email` varchar(150) NOT NULL,
  `otp_hash` varchar(255) NOT NULL,
  `expires_at` datetime NOT NULL,
  `attempts` int(11) NOT NULL DEFAULT 0,
  `last_sent_at` datetime NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Đang kết xuất đổ dữ liệu cho bảng ptit_online_exam.email_otps: ~1 rows (xấp xỉ)

-- Đang kết xuất đổ cấu trúc cho bảng ptit_online_exam.exam_attempts
CREATE TABLE IF NOT EXISTS `exam_attempts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `exam_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `started_at` datetime NOT NULL DEFAULT current_timestamp(),
  `status` enum('IN_PROGRESS','COMPLETED') NOT NULL DEFAULT 'IN_PROGRESS',
  `is_suspended` tinyint(1) NOT NULL DEFAULT 0,
  `suspend_reason` varchar(255) DEFAULT NULL,
  `tab_switch_count` int(11) NOT NULL DEFAULT 0,
  `last_violation_at` datetime DEFAULT NULL,
  `last_violation_reason` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_exam_attempt` (`exam_id`,`user_id`),
  KEY `fk_attempt_user` (`user_id`),
  CONSTRAINT `fk_attempt_exam` FOREIGN KEY (`exam_id`) REFERENCES `exams` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_attempt_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=39 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Đang kết xuất đổ dữ liệu cho bảng ptit_online_exam.exam_attempts: ~4 rows (xấp xỉ)

-- Đang kết xuất đổ cấu trúc cho bảng ptit_online_exam.exam_questions
CREATE TABLE IF NOT EXISTS `exam_questions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `exam_id` int(11) NOT NULL,
  `question_id` int(11) NOT NULL,
  `order_index` int(11) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_exam_question` (`exam_id`,`question_id`),
  KEY `fk_eq_question` (`question_id`),
  CONSTRAINT `fk_eq_exam` FOREIGN KEY (`exam_id`) REFERENCES `exams` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_eq_question` FOREIGN KEY (`question_id`) REFERENCES `questions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=34 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Đang kết xuất đổ dữ liệu cho bảng ptit_online_exam.exam_questions: ~24 rows (xấp xỉ)
INSERT INTO `exam_questions` (`id`, `exam_id`, `question_id`, `order_index`) VALUES
	(1, 1, 1, 1),
	(2, 1, 2, 2),
	(3, 1, 3, 3),
	(4, 1, 4, 4),
	(5, 1, 5, 5),
	(6, 1, 6, 6),
	(7, 2, 7, 1),
	(8, 2, 8, 2),
	(9, 2, 9, 3),
	(10, 2, 10, 4),
	(11, 3, 11, 1),
	(12, 3, 12, 2),
	(13, 3, 13, 3),
	(14, 4, 14, 1),
	(15, 4, 15, 2),
	(16, 5, 1, 1),
	(17, 5, 2, 2),
	(18, 5, 3, 3),
	(19, 5, 4, 4),
	(20, 5, 16, 5),
	(21, 5, 6, 6),
	(22, 5, 5, 7),
	(27, 6, 17, 1),
	(28, 6, 19, 2),
	(29, 7, 27, 1),
	(30, 7, 29, 2),
	(31, 7, 28, 3),
	(32, 7, 30, 4),
	(33, 7, 26, 5);

-- Đang kết xuất đổ cấu trúc cho bảng ptit_online_exam.exams
CREATE TABLE IF NOT EXISTS `exams` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `subject_id` int(11) NOT NULL,
  `title` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `duration_minutes` int(11) NOT NULL DEFAULT 30,
  `pass_score` decimal(4,2) NOT NULL DEFAULT 5.00,
  `is_published` tinyint(1) NOT NULL DEFAULT 1,
  `major_group` enum('ALL','KY_THUAT','KINH_TE') NOT NULL DEFAULT 'ALL',
  `exam_session` varchar(150) DEFAULT NULL,
  `exam_shift` varchar(100) DEFAULT NULL,
  `shuffle_questions` tinyint(1) NOT NULL DEFAULT 0,
  `shuffle_options` tinyint(1) NOT NULL DEFAULT 0,
  `anti_cheat` tinyint(1) NOT NULL DEFAULT 0,
  `max_tab_switches` int(11) DEFAULT NULL,
  `max_attempts` int(11) DEFAULT NULL,
  `open_at` datetime DEFAULT NULL,
  `close_at` datetime DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `fk_exam_subject` (`subject_id`),
  KEY `fk_exam_teacher` (`created_by`),
  CONSTRAINT `fk_exam_subject` FOREIGN KEY (`subject_id`) REFERENCES `subjects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_exam_teacher` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Đang kết xuất đổ dữ liệu cho bảng ptit_online_exam.exams: ~6 rows (xấp xỉ)
INSERT INTO `exams` (`id`, `subject_id`, `title`, `description`, `duration_minutes`, `pass_score`, `is_published`, `major_group`, `exam_session`, `exam_shift`, `shuffle_questions`, `shuffle_options`, `anti_cheat`, `max_tab_switches`, `max_attempts`, `open_at`, `close_at`, `created_by`, `created_at`, `updated_at`) VALUES
	(1, 1, 'Đề thi Cuối kỳ: Lập trình Web Fullstack (React + Express + MySQL)', 'Đánh giá toàn diện kiến thức về React Router v6, Context API, Zustand, RESTful API với Express và bảo mật JWT.', 25, 5.00, 1, 'ALL', NULL, NULL, 0, 0, 0, NULL, 0, NULL, NULL, 5, '2026-11-23 11:49:29', '2026-11-25 16:19:10'),
	(2, 2, 'Đề kiểm tra Giữa kỳ: Hệ quản trị CSDL MySQL & Thiết kế Quan hệ', 'Kiểm tra kỹ năng truy vấn JOIN, GROUP BY, HAVING, thiết kế khóa ngoại và chuẩn hóa cơ sở dữ liệu.', 20, 5.00, 1, 'ALL', NULL, NULL, 0, 0, 0, NULL, 0, NULL, NULL, 5, '2026-11-23 11:49:29', '2026-11-25 16:19:10'),
	(3, 3, 'Đề ôn tập: Kiến trúc Mạng máy tính & Giao thức TCP/IP', 'Tổng hợp các câu hỏi trắc nghiệm trọng tâm về mô hình OSI, TCP/IP, DNS, HTTP và cổng dịch vụ.', 15, 5.00, 1, 'ALL', NULL, NULL, 0, 0, 0, NULL, 0, NULL, NULL, 5, '2026-11-23 11:49:29', '2026-11-25 16:19:10'),
	(4, 4, 'Đề luyện tập nhanh: Cấu trúc dữ liệu & Giải thuật căn bản', 'Ôn tập độ phức tạp thuật toán, tìm kiếm nhị phân, ngăn xếp và hàng đợi.', 15, 5.00, 1, 'ALL', NULL, NULL, 0, 0, 0, NULL, 0, NULL, NULL, 5, '2026-11-23 11:49:29', '2026-11-25 16:19:10'),
	(5, 1, 'abcd', '', 25, 5.00, 1, 'ALL', NULL, NULL, 0, 0, 0, NULL, 0, NULL, NULL, 5, '2026-11-23 21:34:29', '2026-11-25 16:19:10'),
	(6, 1, 'ĐỀ GK1 Lần 1', '', 25, 5.00, 1, 'ALL', 'Thi gk1', 'Ca 1', 1, 1, 1, 1, 1, '2026-11-24 22:05:00', '2026-11-25 17:15:00', 5, '2026-11-23 22:15:37', '2026-11-25 16:15:40'),
	(7, 6, 'Đề 01', '', 25, 5.00, 1, 'KINH_TE', NULL, NULL, 0, 0, 0, NULL, NULL, NULL, NULL, 5, '2026-11-25 14:55:48', '2026-11-25 21:55:48');

-- Đang kết xuất đổ cấu trúc cho bảng ptit_online_exam.login_otps
CREATE TABLE IF NOT EXISTS `login_otps` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `email` varchar(150) NOT NULL,
  `otp_hash` varchar(255) NOT NULL,
  `expires_at` datetime NOT NULL,
  `attempts` int(11) NOT NULL DEFAULT 0,
  `last_sent_at` datetime NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_id` (`user_id`),
  CONSTRAINT `fk_login_otp_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=23 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Đang kết xuất đổ dữ liệu cho bảng ptit_online_exam.login_otps: ~0 rows (xấp xỉ)

-- Đang kết xuất đổ cấu trúc cho bảng ptit_online_exam.password_resets
CREATE TABLE IF NOT EXISTS `password_resets` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `email` varchar(150) NOT NULL,
  `otp_code` varchar(255) NOT NULL,
  `expires_at` datetime NOT NULL,
  `failed_attempts` int(11) NOT NULL DEFAULT 0,
  `used` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Đang kết xuất đổ dữ liệu cho bảng ptit_online_exam.password_resets: ~0 rows (xấp xỉ)

-- Đang kết xuất đổ cấu trúc cho bảng ptit_online_exam.questions
CREATE TABLE IF NOT EXISTS `questions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `subject_id` int(11) NOT NULL,
  `content` text NOT NULL,
  `option_a` text NOT NULL,
  `option_b` text NOT NULL,
  `option_c` text NOT NULL,
  `option_d` text NOT NULL,
  `correct_answer` enum('A','B','C','D') NOT NULL,
  `difficulty` enum('EASY','MEDIUM','HARD') NOT NULL DEFAULT 'MEDIUM',
  `explanation` text DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `fk_question_subject` (`subject_id`),
  KEY `fk_question_teacher` (`created_by`),
  CONSTRAINT `fk_question_subject` FOREIGN KEY (`subject_id`) REFERENCES `subjects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_question_teacher` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=31 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Đang kết xuất đổ dữ liệu cho bảng ptit_online_exam.questions: ~20 rows (xấp xỉ)
INSERT INTO `questions` (`id`, `subject_id`, `content`, `option_a`, `option_b`, `option_c`, `option_d`, `correct_answer`, `difficulty`, `explanation`, `created_by`, `created_at`) VALUES
	(1, 1, 'Trong React Router v6, component nào được dùng làm vùng giữ chỗ (placeholder) để hiển thị các route con trong Layout?', '<Switch />', '<Outlet />', '<RouterView />', '<ChildRoute />', 'B', 'EASY', '<Outlet /> được đặt trong component cha (như MainLayout) để render bất kỳ route con nào khớp với URL hiện tại.', 5, '2026-11-23 11:49:29'),
	(2, 1, 'Hook nào trong React được sử dụng để truy cập trực tiếp giá trị từ một Context đã khởi tạo?', 'useState', 'useEffect', 'useContext', 'useReducer', 'C', 'EASY', 'useContext(MyContext) nhận vào đối tượng Context và trả về giá trị hiện tại được truyền từ Provider gần nhất.', 5, '2026-11-23 11:49:29'),
	(3, 1, 'Trong kiến trúc RESTful API với Express, mã trạng thái HTTP nào biểu thị yêu cầu tạo mới tài nguyên (POST) đã thành công?', '200 OK', '201 Created', '204 No Content', '400 Bad Request', 'B', 'EASY', 'Mã 201 Created là chuẩn RESTful trả về khi một bản ghi mới vừa được khởi tạo thành công trên server.', 5, '2026-11-23 11:49:29'),
	(4, 1, 'Khi xác thực bằng JWT (JSON Web Token), client thường gửi token kèm theo mỗi request ở header nào?', 'Authorization: Bearer <token>', 'Set-Cookie: jwt=<token>', 'X-Powered-By: <token>', 'Content-Type: application/jwt', 'A', 'MEDIUM', 'Chuẩn phổ biến nhất cho JWT là gửi trong HTTP Header \'Authorization\' theo cú pháp \'Bearer <token>\'.', 5, '2026-11-23 11:49:29'),
	(5, 1, 'Ưu điểm lớn nhất của thư viện quản lý state Zustand so với Redux truyền thống là gì?', 'Bắt buộc phải bọc toàn bộ ứng dụng trong nhiều Provider lồng nhau', 'Cấu hình gọn nhẹ, không cần boilerplate (actions/reducers phức tạp), hỗ trợ selector tránh re-render thừa', 'Chỉ hoạt động trên trình duyệt Safari', 'Tự động thay thế hoàn toàn cơ sở dữ liệu MySQL', 'B', 'MEDIUM', 'Zustand sử dụng hook-based store cực kỳ ngắn gọn, không cần Context Provider bọc ngoài và tối ưu re-render nhờ cơ chế selector.', 5, '2026-11-23 11:49:29'),
	(6, 1, 'Hàm middleware xử lý lỗi tập trung (Error-handling middleware) trong Express.js bắt buộc phải khai báo đủ bao nhiêu tham số?', '2 tham số: (req, res)', '3 tham số: (req, res, next)', '4 tham số: (err, req, res, next)', '1 tham số: (err)', 'C', 'HARD', 'Express nhận diện error middleware thông qua chữ ký hàm có đúng 4 tham số (err, req, res, next).', 5, '2026-11-23 11:49:29'),
	(7, 2, 'Trong MySQL, câu lệnh nào dùng để lấy các bản ghi từ hai bảng khi có sự khớp nhau ở trường khóa ngoại?', 'INNER JOIN', 'DROP TABLE', 'ALTER VIEW', 'TRUNCATE', 'A', 'EASY', 'INNER JOIN trả về các hàng khi có ít nhất một giá trị khớp ở cả hai bảng liên kết.', 5, '2026-11-23 11:49:29'),
	(8, 2, 'Để biểu diễn mối quan hệ nhiều - nhiều (N - N) giữa bảng Đề thi (exams) và Câu hỏi (questions) trong MySQL, cách thiết kế chuẩn là gì?', 'Lưu mảng ID câu hỏi dạng chuỗi phân cách dấu phẩy trong bảng exams', 'Tạo một bảng trung gian (ví dụ: exam_questions) chứa hai khóa ngoại trỏ tới exams.id và questions.id', 'Gộp hai bảng exams và questions thành một bảng duy nhất', 'Không thể biểu diễn quan hệ N-N trong MySQL', 'B', 'MEDIUM', 'Chuẩn hóa CSDL quan hệ (3NF) yêu cầu tách quan hệ N-N thành bảng trung gian với 2 khóa ngoại.', 5, '2026-11-23 11:49:29'),
	(9, 2, 'Mệnh đề nào trong SQL được dùng để lọc kết quả SAU KHI đã gom nhóm bằng GROUP BY?', 'WHERE', 'ORDER BY', 'HAVING', 'LIMIT', 'C', 'MEDIUM', 'WHERE lọc các dòng trước khi nhóm, còn HAVING lọc các nhóm sau khi đã thực hiện GROUP BY và hàm tổng hợp (COUNT, AVG, SUM).', 5, '2026-11-23 11:49:29'),
	(10, 2, 'Ràng buộc khóa ngoại `ON DELETE CASCADE` trong MySQL có ý nghĩa gì?', 'Cấm xóa bản ghi ở bảng cha trong mọi trường hợp', 'Khi xóa bản ghi ở bảng cha, các bản ghi con tham chiếu tới nó sẽ tự động được xóa theo', 'Tự động nhân đôi bản ghi con khi xóa bản ghi cha', 'Đổi giá trị khóa ngoại thành số âm', 'B', 'HARD', 'ON DELETE CASCADE giúp đảm bảo toàn vẹn tham chiếu bằng cách tự động xóa các bản ghi phụ thuộc ở bảng con.', 5, '2026-11-23 11:49:29'),
	(11, 3, 'Giao thức HTTP/HTTPS hoạt động ở tầng nào trong mô hình TCP/IP?', 'Tầng Ứng dụng (Application Layer)', 'Tầng Giao vận (Transport Layer)', 'Tầng Mạng (Network Layer)', 'Tầng Vật lý (Physical Layer)', 'A', 'EASY', 'HTTP, DNS, FTP, SMTP đều là các giao thức thuộc tầng Ứng dụng (Application Layer).', 5, '2026-11-23 11:49:29'),
	(12, 3, 'Cổng (Port) mặc định của dịch vụ cơ sở dữ liệu MySQL là bao nhiêu?', '80', '443', '3306', '27017', 'C', 'EASY', 'MySQL mặc định lắng nghe trên cổng 3306 (trong khi 80 là HTTP, 443 là HTTPS, 27017 là MongoDB).', 5, '2026-11-23 11:49:29'),
	(13, 3, 'Giao thức nào đảm nhiệm việc phân giải tên miền (Domain Name) thành địa chỉ IP?', 'DHCP', 'DNS', 'ICMP', 'ARP', 'B', 'MEDIUM', 'DNS (Domain Name System) là hệ thống phân giải tên miền thành địa chỉ IP tương ứng.', 5, '2026-11-23 11:49:29'),
	(14, 4, 'Độ phức tạp thời gian trung bình của thuật toán Tìm kiếm nhị phân (Binary Search) trên mảng đã sắp xếp có n phần tử là bao nhiêu?', 'O(n)', 'O(log n)', 'O(n log n)', 'O(n^2)', 'B', 'EASY', 'Mỗi bước Binary Search chia đôi không gian tìm kiếm nên độ phức tạp thời gian là O(log n).', 5, '2026-11-23 11:49:29'),
	(15, 4, 'Cấu trúc dữ liệu Ngăn xếp (Stack) hoạt động theo nguyên tắc nào?', 'FIFO (First In - First Out)', 'LIFO (Last In - First Out)', 'Random Access', 'Priority Queue', 'B', 'EASY', 'Stack hoạt động theo cơ chế Vào sau - Ra trước (LIFO: Last In, First Out).', 5, '2026-11-23 11:49:29'),
	(16, 1, 'Giao thức nào hoạt động ở tầng Transport trong mô hình OSI và đảm bảo truyền dữ liệu tin cậy?', 'UDP', 'IP', 'TCP', 'HTTP', 'C', 'MEDIUM', 'TCP (Transmission Control Protocol) cung cấp cơ chế bắt tay 3 bước, kiểm soát luồng và truyền lại gói tin bị mất.', 5, '2026-11-23 19:45:33'),
	(17, 1, 'Trong React, Hook nào dùng để quản lý trạng thái (state) cục bộ bên trong một Functional Component?', 'useEffect', 'useState', 'useRef', 'useMemo', 'B', 'MEDIUM', 'useState trả về một cặp gồm giá trị state hiện tại và hàm cập nhật giá trị đó.', 5, '2026-11-23 19:45:33'),
	(18, 1, 'Mã trạng thái HTTP 401 (Unauthorized) biểu thị điều gì?', 'Không tìm thấy tài nguyên yêu cầu', 'Lỗi nội bộ phía máy chủ', 'Yêu cầu chưa được xác thực hoặc token không hợp lệ', 'Yêu cầu thành công và đã tạo mới dữ liệu', 'C', 'MEDIUM', '', 5, '2026-11-23 19:45:33'),
	(19, 1, 'Trong cơ sở dữ liệu quan hệ (SQL), lệnh nào dùng để gom nhóm các bản ghi có cùng giá trị?', 'ORDER BY', 'GROUP BY', 'HAVING', 'DISTINCT', 'B', 'MEDIUM', '', 5, '2026-11-23 19:45:33'),
	(20, 1, 'Kiểu lưu trữ nào trên trình duyệt sẽ tự động bị xóa khi người dùng đóng tab hoặc cửa sổ trình duyệt?', 'localStorage', 'sessionStorage', 'IndexedDB', 'Cache Storage', 'B', 'MEDIUM', 'Dữ liệu trong sessionStorage chỉ tồn tại trong suốt phiên làm việc của tab hiện tại.', 5, '2026-11-23 19:45:33'),
	(21, 5, 'Theo quy luật cầu, khi giá của một hàng hóa tăng lên (trong điều kiện các yếu tố khác không đổi) thì lượng cầu đối với hàng hóa đó sẽ:', 'Giảm xuống', 'Tăng lên', 'Không thay đổi', 'Tăng mạnh rồi giảm', 'A', 'MEDIUM', 'Quy luật cầu phát biểu rằng giá cả và lượng cầu có mối quan hệ nghịch biến khi các yếu tố khác giữ nguyên.', 5, '2026-11-25 14:45:44'),
	(22, 5, 'Yếu tố nào sau đây KHÔNG làm dịch chuyển đường cầu của mặt hàng cà phê?', 'Thu nhập bình quân của người tiêu dùng tăng', 'Giá của mặt hàng trà (hàng hóa thay thế) tăng mạnh', 'Giá bán của chính mặt hàng cà phê đó thay đổi', 'Thị hiếu của giới trẻ chuyển sang ưa chuộng uống cà phê hơn', 'C', 'MEDIUM', 'Sự thay đổi giá của chính hàng hóa đó chỉ gây ra sự trượt dọc (di chuyển) trên đường cầu hiện tại, không làm dịch chuyển toàn bộ đường cầu.', 5, '2026-11-25 14:45:44'),
	(23, 5, 'Khi Chính phủ quy định mức giá trần (giá tối đa) thấp hơn mức giá cân bằng của thị trường, hiện tượng gì sẽ xảy ra?', 'Dư thừa hàng hóa trên thị trường', 'Thiếu hụt hàng hóa trên thị trường', 'Thị trường tự động đạt trạng thái cân bằng mới', 'Lượng cung vượt quá lượng cầu', 'B', 'MEDIUM', 'Giá trần thấp hơn giá cân bằng khiến người mua muốn mua nhiều hơn (lượng cầu tăng) trong khi người bán không muốn bán nhiều (lượng cung giảm), dẫn đến thiếu hụt hàng hóa.', 5, '2026-11-25 14:45:44'),
	(24, 5, 'Hệ số co giãn của cầu theo giá (Ed) của một mặt hàng có giá trị tuyệt đối bằng 2,5 cho biết cầu đối với hàng hóa đó là:', 'Co giãn nhiều', 'Ít co giãn', 'Hoàn toàn không co giãn', 'Co giãn đơn vị', 'A', 'MEDIUM', 'Khi |Ed| > 1, phần trăm thay đổi của lượng cầu lớn hơn phần trăm thay đổi của giá, thể hiện cầu co giãn nhiều theo giá.', 5, '2026-11-25 14:45:44'),
	(25, 5, 'Chi phí cơ hội của việc một sinh viên quyết định dành 4 năm học đại học bao gồm khoản nào sau đây?', 'Tiền ăn uống sinh hoạt hàng ngày', 'Khoản thu nhập bị mất đi do không đi làm toàn thời gian trong 4 năm đó', 'Tiền thuê phòng trọ hàng tháng', 'Chi phí mua quần áo cá nhân', 'B', 'MEDIUM', 'Chi phí cơ hội là giá trị của phương án tốt nhất bị bỏ qua khi đưa ra lựa chọn kinh tế, ở đây là khoản lương có thể kiếm được nếu đi làm thay vì đi học.', 5, '2026-11-25 14:45:44'),
	(26, 6, 'Phương trình kế toán cơ bản nào sau đây luôn luôn đúng tại mọi thời điểm của doanh nghiệp?', 'Tài sản = Nợ phải trả - Vốn chủ sở hữu', 'Tài sản + Nợ phải trả = Vốn chủ sở hữu', 'Tài sản = Nợ phải trả + Vốn chủ sở hữu', 'Vốn chủ sở hữu = Tài sản + Nợ phải trả', 'C', 'MEDIUM', 'Tổng nguồn lực kinh tế doanh nghiệp đang nắm giữ (Tài sản) luôn cân bằng với tổng nguồn hình thành nên tài sản đó (Nợ phải trả và Vốn chủ sở hữu).', 5, '2026-11-25 14:55:03'),
	(27, 6, 'Khi doanh nghiệp mua nguyên vật liệu nhập kho trị giá 50 triệu đồng và đã thanh toán ngay bằng chuyển khoản ngân hàng, nghiệp vụ này làm cho:', 'Tổng tài sản tăng 50 triệu đồng', 'Tổng tài sản giảm 50 triệu đồng', 'Tổng tài sản không thay đổi', 'Nợ phải trả tăng 50 triệu đồng', 'C', 'MEDIUM', 'Một tài sản tăng lên (Nguyên vật liệu tăng 50 triệu) đồng thời một tài sản khác giảm xuống tương ứng (Tiền gửi ngân hàng giảm 50 triệu) nên tổng tài sản giữ nguyên.', 5, '2026-11-25 14:55:03'),
	(28, 6, 'Khoản mục nào sau đây được phân loại là Nợ phải trả trên Bảng cân đối kế toán?', 'Phải thu của khách hàng', 'Người mua trả tiền trước', 'Chi phí trả trước ngắn hạn', 'Tạm ứng cho nhân viên', 'B', 'MEDIUM', 'Người mua trả tiền trước là khoản doanh nghiệp đã nhận tiền nhưng chưa giao hàng/cung cấp dịch vụ, do đó tạo thành nghĩa vụ phải trả (nợ) đối với khách hàng.', 5, '2026-11-25 14:55:03'),
	(29, 6, 'Theo nguyên tắc cơ sở dồn tích (Accrual Basis), doanh thu bán hàng được ghi nhận vào sổ sách kế toán tại thời điểm nào?', 'Khi khách hàng ký hợp đồng đặt hàng', 'Khi doanh nghiệp thu được tiền mặt từ khách hàng', 'Khi quyền sở hữu hàng hóa đã chuyển giao cho khách hàng và khách hàng chấp nhận thanh toán', 'Khi doanh nghiệp xuất kho hàng hóa đi vận chuyển', 'C', 'MEDIUM', 'Cơ sở dồn tích yêu cầu ghi nhận doanh thu tại thời điểm phát sinh giao dịch và chuyển giao rủi ro/lợi ích của hàng hóa, không phụ thuộc vào thời điểm thực tế thu tiền.', 5, '2026-11-25 14:55:03'),
	(30, 6, 'Nguyên tắc thận trọng trong kế toán yêu cầu doanh nghiệp thực hiện điều nào sau đây?', 'Lập dự phòng rủi ro nhưng không lập quá lớn, không đánh giá cao hơn giá trị của các tài sản', 'Ghi nhận ngay các khoản doanh thu tiềm năng chưa chắc chắn để làm đẹp báo cáo', 'Trì hoãn việc ghi nhận các khoản chi phí và nợ phải trả sang kỳ sau', 'Luôn định giá hàng tồn kho theo giá bán cao nhất trên thị trường', 'A', 'MEDIUM', 'Nguyên tắc thận trọng đòi hỏi kế toán phải lập các khoản dự phòng hợp lý, không phóng đại tài sản/thu nhập và không bỏ sót nợ phải trả/chi phí.', 5, '2026-11-25 14:55:03');

-- Đang kết xuất đổ cấu trúc cho bảng ptit_online_exam.subjects
CREATE TABLE IF NOT EXISTS `subjects` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `code` varchar(30) NOT NULL,
  `name` varchar(150) NOT NULL,
  `description` text DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`),
  KEY `fk_subject_teacher` (`created_by`),
  CONSTRAINT `fk_subject_teacher` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Đang kết xuất đổ dữ liệu cho bảng ptit_online_exam.subjects: ~4 rows (xấp xỉ)
INSERT INTO `subjects` (`id`, `code`, `name`, `description`, `created_by`, `created_at`) VALUES
	(1, 'INT1434', 'Lập trình Web', 'Học phần phát triển ứng dụng Web Fullstack với ReactJS, Node.js, Express và CSDL quan hệ.', 5, '2026-11-23 11:49:29'),
	(2, 'INT1313', 'Cơ sở dữ liệu', 'Mô hình dữ liệu quan hệ, đại số quan hệ, ngôn ngữ truy vấn SQL và chuẩn hóa cơ sở dữ liệu.', 5, '2026-11-23 11:49:29'),
	(3, 'INT1336', 'Mạng máy tính', 'Kiến trúc phân tầng OSI, TCP/IP, định tuyến IP, DNS, HTTP và an toàn mạng căn bản.', 5, '2026-11-23 11:49:29'),
	(4, 'INT1306', 'Cấu trúc dữ liệu & Giải thuật', 'Danh sách liên kết, ngăn xếp, hàng đợi, cây nhị phân, đồ thị và các thuật toán sắp xếp, tìm kiếm.', 5, '2026-11-23 11:49:29'),
	(5, 'BAS1123', 'Kinh tế vi mô — Cung Cầu & Thị Trường', '', 5, '2026-11-25 14:45:16'),
	(6, 'FIN1202', 'Nguyên lý kế toán', '', 5, '2026-11-25 14:54:40');

-- Đang kết xuất đổ cấu trúc cho bảng ptit_online_exam.submissions
CREATE TABLE IF NOT EXISTS `submissions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `exam_id` int(11) NOT NULL,
  `student_id` int(11) NOT NULL,
  `score` decimal(4,2) NOT NULL DEFAULT 0.00,
  `correct_count` int(11) NOT NULL DEFAULT 0,
  `total_questions` int(11) NOT NULL DEFAULT 0,
  `time_spent_seconds` int(11) NOT NULL DEFAULT 0,
  `started_at` datetime DEFAULT NULL,
  `tab_switch_count` int(11) NOT NULL DEFAULT 0,
  `is_suspended` tinyint(1) NOT NULL DEFAULT 0,
  `suspend_reason` varchar(255) DEFAULT NULL,
  `answers_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`answers_json`)),
  `submitted_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `fk_sub_exam` (`exam_id`),
  KEY `fk_sub_student` (`student_id`),
  CONSTRAINT `fk_sub_exam` FOREIGN KEY (`exam_id`) REFERENCES `exams` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_sub_student` FOREIGN KEY (`student_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Đang kết xuất đổ dữ liệu cho bảng ptit_online_exam.submissions: ~3 rows (xấp xỉ)

-- Đang kết xuất đổ cấu trúc cho bảng ptit_online_exam.users
CREATE TABLE IF NOT EXISTS `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `full_name` varchar(120) NOT NULL,
  `email` varchar(150) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `role` varchar(30) NOT NULL DEFAULT 'STUDENT',
  `student_code` varchar(30) DEFAULT NULL,
  `major_group` enum('KY_THUAT','KINH_TE') DEFAULT NULL,
  `is_super_admin` tinyint(1) NOT NULL DEFAULT 0,
  `first_login_approved` tinyint(1) NOT NULL DEFAULT 0,
  `pending_first_login` tinyint(1) NOT NULL DEFAULT 0,
  `must_change_password` tinyint(1) NOT NULL DEFAULT 0,
  `token_version` int(11) NOT NULL DEFAULT 1,
  `failed_login_attempts` int(11) NOT NULL DEFAULT 0,
  `locked_until` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  UNIQUE KEY `uq_users_student_code` (`student_code`),
  UNIQUE KEY `student_code` (`student_code`)
) ENGINE=InnoDB AUTO_INCREMENT=14 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Đang kết xuất đổ dữ liệu cho bảng ptit_online_exam.users: ~3 rows (xấp xỉ)
INSERT INTO `users` (`id`, `full_name`, `email`, `password_hash`, `role`, `student_code`, `major_group`, `is_super_admin`, `first_login_approved`, `pending_first_login`, `must_change_password`, `token_version`, `failed_login_attempts`, `locked_until`, `created_at`) VALUES
	(5, 'Quản trị viên Hệ thống (PTIT)', 'phamduc31122006aa@gmail.com', '$2a$10$mCmWkNFFPMv45Eq1/yRT8eccjcbjClCCJUfKv0d7VpW/rusKtv2o6', 'TEACHER', 'GV001', NULL, 1, 1, 0, 0, 14, 0, NULL, '2026-11-23 13:44:17'),
	(11, 'Quản trị viên Hệ thống (PTIT)', 'admin@ptit.edu.vn', '$2a$10$SSQiHpoCGrD4wP2ko3fOoecvs0VIt5fZksQyADFh5nf4vmw8f6sIe', 'TEACHER', NULL, NULL, 1, 1, 0, 0, 2, 0, NULL, '2026-11-25 04:33:32'),
	(13, 'Nguyễn Văn Demo', 'sinhvien@ptit.edu.vn', '$2a$10$SDsj8sOLMJ49A42NHUeKceoCnQtVgbGniR5GJ/JlIadQ6RYBEvCV2', 'STUDENT', 'B25DCCC999', 'KY_THUAT', 0, 0, 0, 0, 1, 0, NULL, '2026-11-25 14:39:43');

/*!40103 SET TIME_ZONE=IFNULL(@OLD_TIME_ZONE, 'system') */;
/*!40101 SET SQL_MODE=IFNULL(@OLD_SQL_MODE, '') */;
/*!40014 SET FOREIGN_KEY_CHECKS=IFNULL(@OLD_FOREIGN_KEY_CHECKS, 1) */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40111 SET SQL_NOTES=IFNULL(@OLD_SQL_NOTES, 1) */;
