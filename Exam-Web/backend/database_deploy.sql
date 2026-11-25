SET FOREIGN_KEY_CHECKS=0;
SET SQL_MODE="NO_AUTO_VALUE_ON_ZERO";
SET NAMES utf8mb4;
SET TIME_ZONE='+00:00';

--
-- Table structure for table `admin_logs`
--

DROP TABLE IF EXISTS `admin_logs`;
CREATE TABLE `admin_logs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `admin_id` int(11) DEFAULT NULL,
  `admin_name` varchar(100) NOT NULL,
  `action_type` varchar(50) NOT NULL,
  `exam_title` varchar(255) NOT NULL,
  `subject_code` varchar(50) DEFAULT NULL,
  `details` text DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=12 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `admin_logs`
--

INSERT INTO `admin_logs` VALUES
(1,5,'Phạm Anh Đức','CREATE_EXAM','ĐỀ GK1 Lần 1','INT1434','Thêm đề mới gồm 2 câu hỏi (25 phút)','2026-11-24 05:15:37'),
(2,5,'Phạm Anh Đức','UPDATE_EXAM','ĐỀ GK1 Lần 1','INT1434','Cập nhật đề thi (2 câu hỏi, 25 phút)','2026-11-24 22:05:46'),
(3,5,'Phạm Anh Đức','UNSUSPEND_SUBMISSION','ĐỀ GK1 Lần 1','INT1434','Gỡ vi phạm & mở lại lượt thi cho SV Ngô Thanh Phong (B25DCCC170)','2026-11-24 22:46:22'),
(4,5,'Phạm Anh Đức','UNSUSPEND_SUBMISSION','ĐỀ GK1 Lần 1','INT1434','Gỡ vi phạm & mở lại lượt thi cho SV Lê Đăng Khoa (B25DCCC110)','2026-11-24 22:46:26'),
(5,5,'Quản trị viên Hệ thống (PTIT)','CREATE_ADMIN','Duc (phamduc1011a@gmail.com)',NULL,'Cấp quyền Admin mới (yêu cầu Super Admin duyệt lần đăng nhập đầu tiên)','2026-11-25 12:24:21'),
(6,5,'Quản trị viên Hệ thống (PTIT)','UNSUSPEND_SUBMISSION','Đề luyện tập nhanh: Cấu trúc dữ liệu & Giải thuật căn bản','INT1306','Gỡ vi phạm & mở lại lượt thi cho SV Lê Đăng Khoa (B25DCCC110)','2026-11-25 16:11:39'),
(7,5,'Quản trị viên Hệ thống (PTIT)','UNSUSPEND_SUBMISSION','Đề luyện tập nhanh: Cấu trúc dữ liệu & Giải thuật căn bản','INT1306','Gỡ vi phạm & mở lại lượt thi cho SV Quản trị viên Hệ thống (PTIT) (GV001)','2026-11-25 16:11:49'),
(8,5,'Quản trị viên Hệ thống (PTIT)','REOPEN_EXAM','ĐỀ GK1 Lần 1','INT1434','Mở lại đề thi đã đóng (mở tự do)','2026-11-25 16:15:08'),
(9,5,'Quản trị viên Hệ thống (PTIT)','UPDATE_EXAM','ĐỀ GK1 Lần 1','INT1434','Cập nhật đề thi (2 câu hỏi, 25 phút)','2026-11-25 16:15:40'),
(10,5,'Quản trị viên Hệ thống (PTIT)','UNSUSPEND_SUBMISSION','ĐỀ GK1 Lần 1','INT1434','Gỡ vi phạm & mở lại lượt thi cho SV Lê Đăng Khoa (B25DCCC110)','2026-11-25 16:17:33'),
(11,11,'Quản trị viên Hệ thống (PTIT)','UNSUSPEND_SUBMISSION','ĐỀ GK1 Lần 1','INT1434','Gỡ vi phạm & mở lại lượt thi cho SV Lê Đăng Khoa (B25DCCC110)','2026-11-25 16:33:44');

--
-- Table structure for table `email_otps`
--

DROP TABLE IF EXISTS `email_otps`;
CREATE TABLE `email_otps` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `email` varchar(150) NOT NULL,
  `otp_hash` varchar(255) NOT NULL,
  `expires_at` datetime NOT NULL,
  `attempts` int(11) NOT NULL DEFAULT 0,
  `last_sent_at` datetime NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `email_otps`
--

--
-- Table structure for table `exam_attempts`
--

DROP TABLE IF EXISTS `exam_attempts`;
CREATE TABLE `exam_attempts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `exam_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `started_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
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

--
-- Dumping data for table `exam_attempts`
--

--
-- Table structure for table `exam_questions`
--

DROP TABLE IF EXISTS `exam_questions`;
CREATE TABLE `exam_questions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `exam_id` int(11) NOT NULL,
  `question_id` int(11) NOT NULL,
  `order_index` int(11) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_exam_question` (`exam_id`,`question_id`),
  KEY `fk_eq_question` (`question_id`),
  CONSTRAINT `fk_eq_exam` FOREIGN KEY (`exam_id`) REFERENCES `exams` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_eq_question` FOREIGN KEY (`question_id`) REFERENCES `questions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=29 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `exam_questions`
--

INSERT INTO `exam_questions` VALUES
(1,1,1,1),
(2,1,2,2),
(3,1,3,3),
(4,1,4,4),
(5,1,5,5),
(6,1,6,6),
(7,2,7,1),
(8,2,8,2),
(9,2,9,3),
(10,2,10,4),
(11,3,11,1),
(12,3,12,2),
(13,3,13,3),
(14,4,14,1),
(15,4,15,2),
(16,5,1,1),
(17,5,2,2),
(18,5,3,3),
(19,5,4,4),
(20,5,16,5),
(21,5,6,6),
(22,5,5,7),
(27,6,17,1),
(28,6,19,2);

--
-- Table structure for table `exams`
--

DROP TABLE IF EXISTS `exams`;
CREATE TABLE `exams` (
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
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_exam_subject` (`subject_id`),
  KEY `fk_exam_teacher` (`created_by`),
  CONSTRAINT `fk_exam_subject` FOREIGN KEY (`subject_id`) REFERENCES `subjects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_exam_teacher` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `exams`
--

INSERT INTO `exams` VALUES
(1,1,'Đề thi Cuối kỳ: Lập trình Web Fullstack (React + Express + MySQL)','Đánh giá toàn diện kiến thức về React Router v6, Context API, Zustand, RESTful API với Express và bảo mật JWT.',25,5.00,1,'ALL',NULL,NULL,0,0,0,NULL,0,NULL,NULL,5,'2026-11-23 11:49:29','2026-11-25 16:19:10'),
(2,2,'Đề kiểm tra Giữa kỳ: Hệ quản trị CSDL MySQL & Thiết kế Quan hệ','Kiểm tra kỹ năng truy vấn JOIN, GROUP BY, HAVING, thiết kế khóa ngoại và chuẩn hóa cơ sở dữ liệu.',20,5.00,1,'ALL',NULL,NULL,0,0,0,NULL,0,NULL,NULL,5,'2026-11-23 11:49:29','2026-11-25 16:19:10'),
(3,3,'Đề ôn tập: Kiến trúc Mạng máy tính & Giao thức TCP/IP','Tổng hợp các câu hỏi trắc nghiệm trọng tâm về mô hình OSI, TCP/IP, DNS, HTTP và cổng dịch vụ.',15,5.00,1,'ALL',NULL,NULL,0,0,0,NULL,0,NULL,NULL,5,'2026-11-23 11:49:29','2026-11-25 16:19:10'),
(4,4,'Đề luyện tập nhanh: Cấu trúc dữ liệu & Giải thuật căn bản','Ôn tập độ phức tạp thuật toán, tìm kiếm nhị phân, ngăn xếp và hàng đợi.',15,5.00,1,'ALL',NULL,NULL,0,0,0,NULL,0,NULL,NULL,5,'2026-11-23 11:49:29','2026-11-25 16:19:10'),
(5,1,'abcd','',25,5.00,1,'ALL',NULL,NULL,0,0,0,NULL,0,NULL,NULL,5,'2026-11-23 21:34:29','2026-11-25 16:19:10'),
(6,1,'ĐỀ GK1 Lần 1','',25,5.00,1,'ALL','Thi gk1','Ca 1',1,1,1,1,1,'2026-11-24 22:05:00','2026-11-25 17:15:00',5,'2026-11-23 22:15:37','2026-11-25 16:15:40');

--
-- Table structure for table `login_otps`
--

DROP TABLE IF EXISTS `login_otps`;
CREATE TABLE `login_otps` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `email` varchar(150) NOT NULL,
  `otp_hash` varchar(255) NOT NULL,
  `expires_at` datetime NOT NULL,
  `attempts` int(11) NOT NULL DEFAULT 0,
  `last_sent_at` datetime NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_id` (`user_id`),
  CONSTRAINT `fk_login_otp_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=22 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `login_otps`
--

--
-- Table structure for table `password_resets`
--

DROP TABLE IF EXISTS `password_resets`;
CREATE TABLE `password_resets` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `email` varchar(150) NOT NULL,
  `otp_code` varchar(255) NOT NULL,
  `expires_at` datetime NOT NULL,
  `failed_attempts` int(11) NOT NULL DEFAULT 0,
  `used` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `password_resets`
--

--
-- Table structure for table `questions`
--

DROP TABLE IF EXISTS `questions`;
CREATE TABLE `questions` (
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
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_question_subject` (`subject_id`),
  KEY `fk_question_teacher` (`created_by`),
  CONSTRAINT `fk_question_subject` FOREIGN KEY (`subject_id`) REFERENCES `subjects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_question_teacher` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=21 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `questions`
--

INSERT INTO `questions` VALUES
(1,1,'Trong React Router v6, component nào được dùng làm vùng giữ chỗ (placeholder) để hiển thị các route con trong Layout?','<Switch />','<Outlet />','<RouterView />','<ChildRoute />','B','EASY','<Outlet /> được đặt trong component cha (như MainLayout) để render bất kỳ route con nào khớp với URL hiện tại.',5,'2026-11-23 11:49:29'),
(2,1,'Hook nào trong React được sử dụng để truy cập trực tiếp giá trị từ một Context đã khởi tạo?','useState','useEffect','useContext','useReducer','C','EASY','useContext(MyContext) nhận vào đối tượng Context và trả về giá trị hiện tại được truyền từ Provider gần nhất.',5,'2026-11-23 11:49:29'),
(3,1,'Trong kiến trúc RESTful API với Express, mã trạng thái HTTP nào biểu thị yêu cầu tạo mới tài nguyên (POST) đã thành công?','200 OK','201 Created','204 No Content','400 Bad Request','B','EASY','Mã 201 Created là chuẩn RESTful trả về khi một bản ghi mới vừa được khởi tạo thành công trên server.',5,'2026-11-23 11:49:29'),
(4,1,'Khi xác thực bằng JWT (JSON Web Token), client thường gửi token kèm theo mỗi request ở header nào?','Authorization: Bearer <token>','Set-Cookie: jwt=<token>','X-Powered-By: <token>','Content-Type: application/jwt','A','MEDIUM','Chuẩn phổ biến nhất cho JWT là gửi trong HTTP Header \'Authorization\' theo cú pháp \'Bearer <token>\'.',5,'2026-11-23 11:49:29'),
(5,1,'Ưu điểm lớn nhất của thư viện quản lý state Zustand so với Redux truyền thống là gì?','Bắt buộc phải bọc toàn bộ ứng dụng trong nhiều Provider lồng nhau','Cấu hình gọn nhẹ, không cần boilerplate (actions/reducers phức tạp), hỗ trợ selector tránh re-render thừa','Chỉ hoạt động trên trình duyệt Safari','Tự động thay thế hoàn toàn cơ sở dữ liệu MySQL','B','MEDIUM','Zustand sử dụng hook-based store cực kỳ ngắn gọn, không cần Context Provider bọc ngoài và tối ưu re-render nhờ cơ chế selector.',5,'2026-11-23 11:49:29'),
(6,1,'Hàm middleware xử lý lỗi tập trung (Error-handling middleware) trong Express.js bắt buộc phải khai báo đủ bao nhiêu tham số?','2 tham số: (req, res)','3 tham số: (req, res, next)','4 tham số: (err, req, res, next)','1 tham số: (err)','C','HARD','Express nhận diện error middleware thông qua chữ ký hàm có đúng 4 tham số (err, req, res, next).',5,'2026-11-23 11:49:29'),
(7,2,'Trong MySQL, câu lệnh nào dùng để lấy các bản ghi từ hai bảng khi có sự khớp nhau ở trường khóa ngoại?','INNER JOIN','DROP TABLE','ALTER VIEW','TRUNCATE','A','EASY','INNER JOIN trả về các hàng khi có ít nhất một giá trị khớp ở cả hai bảng liên kết.',5,'2026-11-23 11:49:29'),
(8,2,'Để biểu diễn mối quan hệ nhiều - nhiều (N - N) giữa bảng Đề thi (exams) và Câu hỏi (questions) trong MySQL, cách thiết kế chuẩn là gì?','Lưu mảng ID câu hỏi dạng chuỗi phân cách dấu phẩy trong bảng exams','Tạo một bảng trung gian (ví dụ: exam_questions) chứa hai khóa ngoại trỏ tới exams.id và questions.id','Gộp hai bảng exams và questions thành một bảng duy nhất','Không thể biểu diễn quan hệ N-N trong MySQL','B','MEDIUM','Chuẩn hóa CSDL quan hệ (3NF) yêu cầu tách quan hệ N-N thành bảng trung gian với 2 khóa ngoại.',5,'2026-11-23 11:49:29'),
(9,2,'Mệnh đề nào trong SQL được dùng để lọc kết quả SAU KHI đã gom nhóm bằng GROUP BY?','WHERE','ORDER BY','HAVING','LIMIT','C','MEDIUM','WHERE lọc các dòng trước khi nhóm, còn HAVING lọc các nhóm sau khi đã thực hiện GROUP BY và hàm tổng hợp (COUNT, AVG, SUM).',5,'2026-11-23 11:49:29'),
(10,2,'Ràng buộc khóa ngoại `ON DELETE CASCADE` trong MySQL có ý nghĩa gì?','Cấm xóa bản ghi ở bảng cha trong mọi trường hợp','Khi xóa bản ghi ở bảng cha, các bản ghi con tham chiếu tới nó sẽ tự động được xóa theo','Tự động nhân đôi bản ghi con khi xóa bản ghi cha','Đổi giá trị khóa ngoại thành số âm','B','HARD','ON DELETE CASCADE giúp đảm bảo toàn vẹn tham chiếu bằng cách tự động xóa các bản ghi phụ thuộc ở bảng con.',5,'2026-11-23 11:49:29'),
(11,3,'Giao thức HTTP/HTTPS hoạt động ở tầng nào trong mô hình TCP/IP?','Tầng Ứng dụng (Application Layer)','Tầng Giao vận (Transport Layer)','Tầng Mạng (Network Layer)','Tầng Vật lý (Physical Layer)','A','EASY','HTTP, DNS, FTP, SMTP đều là các giao thức thuộc tầng Ứng dụng (Application Layer).',5,'2026-11-23 11:49:29'),
(12,3,'Cổng (Port) mặc định của dịch vụ cơ sở dữ liệu MySQL là bao nhiêu?','80','443','3306','27017','C','EASY','MySQL mặc định lắng nghe trên cổng 3306 (trong khi 80 là HTTP, 443 là HTTPS, 27017 là MongoDB).',5,'2026-11-23 11:49:29'),
(13,3,'Giao thức nào đảm nhiệm việc phân giải tên miền (Domain Name) thành địa chỉ IP?','DHCP','DNS','ICMP','ARP','B','MEDIUM','DNS (Domain Name System) là hệ thống phân giải tên miền thành địa chỉ IP tương ứng.',5,'2026-11-23 11:49:29'),
(14,4,'Độ phức tạp thời gian trung bình của thuật toán Tìm kiếm nhị phân (Binary Search) trên mảng đã sắp xếp có n phần tử là bao nhiêu?','O(n)','O(log n)','O(n log n)','O(n^2)','B','EASY','Mỗi bước Binary Search chia đôi không gian tìm kiếm nên độ phức tạp thời gian là O(log n).',5,'2026-11-23 11:49:29'),
(15,4,'Cấu trúc dữ liệu Ngăn xếp (Stack) hoạt động theo nguyên tắc nào?','FIFO (First In - First Out)','LIFO (Last In - First Out)','Random Access','Priority Queue','B','EASY','Stack hoạt động theo cơ chế Vào sau - Ra trước (LIFO: Last In, First Out).',5,'2026-11-23 11:49:29'),
(16,1,'Giao thức nào hoạt động ở tầng Transport trong mô hình OSI và đảm bảo truyền dữ liệu tin cậy?','UDP','IP','TCP','HTTP','C','MEDIUM','TCP (Transmission Control Protocol) cung cấp cơ chế bắt tay 3 bước, kiểm soát luồng và truyền lại gói tin bị mất.',5,'2026-11-23 19:45:33'),
(17,1,'Trong React, Hook nào dùng để quản lý trạng thái (state) cục bộ bên trong một Functional Component?','useEffect','useState','useRef','useMemo','B','MEDIUM','useState trả về một cặp gồm giá trị state hiện tại và hàm cập nhật giá trị đó.',5,'2026-11-23 19:45:33'),
(18,1,'Mã trạng thái HTTP 401 (Unauthorized) biểu thị điều gì?','Không tìm thấy tài nguyên yêu cầu','Lỗi nội bộ phía máy chủ','Yêu cầu chưa được xác thực hoặc token không hợp lệ','Yêu cầu thành công và đã tạo mới dữ liệu','C','MEDIUM','',5,'2026-11-23 19:45:33'),
(19,1,'Trong cơ sở dữ liệu quan hệ (SQL), lệnh nào dùng để gom nhóm các bản ghi có cùng giá trị?','ORDER BY','GROUP BY','HAVING','DISTINCT','B','MEDIUM','',5,'2026-11-23 19:45:33'),
(20,1,'Kiểu lưu trữ nào trên trình duyệt sẽ tự động bị xóa khi người dùng đóng tab hoặc cửa sổ trình duyệt?','localStorage','sessionStorage','IndexedDB','Cache Storage','B','MEDIUM','Dữ liệu trong sessionStorage chỉ tồn tại trong suốt phiên làm việc của tab hiện tại.',5,'2026-11-23 19:45:33');

--
-- Table structure for table `subjects`
--

DROP TABLE IF EXISTS `subjects`;
CREATE TABLE `subjects` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `code` varchar(30) NOT NULL,
  `name` varchar(150) NOT NULL,
  `description` text DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`),
  KEY `fk_subject_teacher` (`created_by`),
  CONSTRAINT `fk_subject_teacher` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `subjects`
--

INSERT INTO `subjects` VALUES
(1,'INT1434','Lập trình Web','Học phần phát triển ứng dụng Web Fullstack với ReactJS, Node.js, Express và CSDL quan hệ.',5,'2026-11-23 11:49:29'),
(2,'INT1313','Cơ sở dữ liệu','Mô hình dữ liệu quan hệ, đại số quan hệ, ngôn ngữ truy vấn SQL và chuẩn hóa cơ sở dữ liệu.',5,'2026-11-23 11:49:29'),
(3,'INT1336','Mạng máy tính','Kiến trúc phân tầng OSI, TCP/IP, định tuyến IP, DNS, HTTP và an toàn mạng căn bản.',5,'2026-11-23 11:49:29'),
(4,'INT1306','Cấu trúc dữ liệu & Giải thuật','Danh sách liên kết, ngăn xếp, hàng đợi, cây nhị phân, đồ thị và các thuật toán sắp xếp, tìm kiếm.',5,'2026-11-23 11:49:29');

--
-- Table structure for table `submissions`
--

DROP TABLE IF EXISTS `submissions`;
CREATE TABLE `submissions` (
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
  `answers_json` json NOT NULL,
  `submitted_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_sub_exam` (`exam_id`),
  KEY `fk_sub_student` (`student_id`),
  CONSTRAINT `fk_sub_exam` FOREIGN KEY (`exam_id`) REFERENCES `exams` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_sub_student` FOREIGN KEY (`student_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `submissions`
--

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
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
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  UNIQUE KEY `uq_users_student_code` (`student_code`),
  UNIQUE KEY `student_code` (`student_code`)
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `users`
--

INSERT INTO `users` VALUES
(5,'Quản trị viên Hệ thống (PTIT)','phamduc31122006aa@gmail.com','$2a$10$eqBUGpLej8d5AC3HQCjZ8..mkxxzGt0sxKgnZryn0rmwtifB4HzXC','TEACHER','GV001',NULL,1,1,0,0,14,0,NULL,'2026-11-23 13:44:17'),
(11,'Quản trị viên Hệ thống (PTIT)','admin@ptit.edu.vn','$2a$10$2SH87.mVSLZTpJ1CUl3abO14TdT/oMsinJWWp86H664B8YddEWaDO','TEACHER',NULL,NULL,1,1,0,0,2,0,NULL,'2026-11-25 04:33:32');

SET FOREIGN_KEY_CHECKS=1;
