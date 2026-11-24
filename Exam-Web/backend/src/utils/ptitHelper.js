export const KY_THUAT_MAJORS = {
  CN: "Công nghệ thông tin",
  VT: "Kỹ thuật Điện tử viễn thông",
  CC: "CNTT Định hướng ứng dụng (UDU)",
  CE: "Kỹ thuật máy tính",
  DT: "Công nghệ kỹ thuật Điện, điện tử",
  GA: "Thiết kế và Phát triển Game",
  AT: "An toàn thông tin",
  TN: "AIoT / Kỹ thuật dữ liệu",
  VM: "Thiết kế vi mạch bán dẫn",
  KH: "Khoa học máy tính",
  DK: "Kỹ thuật điều khiển và tự động hóa CLC",
  AE: "Kỹ thuật Điều khiển và Tự động hóa",
  VN: "CNTT Việt - Nhật",
  TE: "Kỹ thuật dữ liệu / Mạng máy tính",
  TV: "CNTT Chất lượng cao",
};

export const KINH_TE_MAJORS = {
  PT: "Công nghệ đa phương tiện",
  MR: "Marketing",
  QT: "Quản trị kinh doanh",
  KT: "Kế toán",
  TM: "Thương mại điện tử",
  TC: "Công nghệ tài chính (Fintech)",
  TT: "Truyền thông đa phương tiện",
  KD: "Kinh doanh quốc tế",
  ME: "Truyền thông đa phương tiện",
  LQ: "Logistics và Quản lý chuỗi cung ứng",
  QC: "Quan hệ công chúng",
  BC: "Báo chí",
  KE: "Kinh tế số",
};

export const MAJOR_GROUP_LABELS = {
  KY_THUAT: "Khối Kỹ thuật",
  KINH_TE: "Khối Kinh tế",
  ALL: "Tất cả khối ngành",
};

const PTIT_DOMAIN = "@stu.ptit.edu.vn";
const SHORT_CODE_REGEX = /^([BN])(\d{2})([A-Z]{2})(\d{3})$/;

export function parsePtitEmail(rawEmail) {
  const invalid = (error) => ({
    isValid: false,
    studentId: null,
    majorCode: null,
    majorName: null,
    majorGroup: null,
    majorGroupLabel: null,
    error,
  });

  if (typeof rawEmail !== "string" || !rawEmail.trim()) {
    return invalid("Vui lòng nhập địa chỉ email sinh viên PTIT.");
  }

  const email = rawEmail.trim().toLowerCase();
  if (!email.endsWith(PTIT_DOMAIN)) {
    return invalid(
      "Chỉ chấp nhận email sinh viên PTIT có đuôi @stu.ptit.edu.vn (VD: DucPA.B25CC302@stu.ptit.edu.vn)."
    );
  }

  const localPart = email.slice(0, -PTIT_DOMAIN.length);
  const lastDotIndex = localPart.lastIndexOf(".");
  if (lastDotIndex <= 0 || lastDotIndex === localPart.length - 1) {
    return invalid(
      "Email phải đúng cấu trúc <TenVietTat>.<MaSV>@stu.ptit.edu.vn (VD: DucPA.B25CC302@stu.ptit.edu.vn)."
    );
  }

  const shortName = localPart.slice(0, lastDotIndex).trim();
  const rawCode = localPart.slice(lastDotIndex + 1).trim().toUpperCase();

  if (!/^[a-z0-9_]+(\.[a-z0-9_]+)*$/i.test(shortName)) {
    return invalid("Phần tên viết tắt trước dấu chấm trong email không hợp lệ.");
  }

  const match = rawCode.match(SHORT_CODE_REGEX);
  if (!match) {
    return invalid(
      "Mã sinh viên trong email không đúng định dạng chuẩn PTIT (VD: B25CC302 hoặc N25CN001)."
    );
  }

  const [, coSo, khoa, maNganh, stt] = match;
  const studentId = `${coSo}${khoa}DC${maNganh}${stt}`;

  if (Object.prototype.hasOwnProperty.call(KY_THUAT_MAJORS, maNganh)) {
    return {
      isValid: true,
      studentId,
      majorCode: maNganh,
      majorName: KY_THUAT_MAJORS[maNganh],
      majorGroup: "KY_THUAT",
      majorGroupLabel: MAJOR_GROUP_LABELS.KY_THUAT,
      error: "",
    };
  }

  if (Object.prototype.hasOwnProperty.call(KINH_TE_MAJORS, maNganh)) {
    return {
      isValid: true,
      studentId,
      majorCode: maNganh,
      majorName: KINH_TE_MAJORS[maNganh],
      majorGroup: "KINH_TE",
      majorGroupLabel: MAJOR_GROUP_LABELS.KINH_TE,
      error: "",
    };
  }

  return invalid(
    `Mã ngành "${maNganh}" trong email không thuộc danh mục 28 ngành đào tạo của PTIT.`
  );
}
