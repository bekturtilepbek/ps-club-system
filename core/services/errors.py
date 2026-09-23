class ServiceError(Exception):
    """Base for service-layer failures. core/api/errors.py maps the three
    subclasses below to HTTP status codes; domain/ never raises these."""


class NotFoundError(ServiceError):
    pass


class ConflictError(ServiceError):
    pass


class ValidationError(ServiceError):
    pass
